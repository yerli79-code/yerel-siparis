-- Add business-configured payment methods and persist the selected order method.

begin;

alter table public.businesses
  add column if not exists payment_method_mode text not null default 'cash';

do $$
declare
  v_type oid;
  v_not_null boolean;
  v_default text;
begin
  select
    a.atttypid,
    a.attnotnull,
    pg_get_expr(d.adbin, d.adrelid)
  into
    v_type,
    v_not_null,
    v_default
  from pg_attribute a
  left join pg_attrdef d
    on d.adrelid = a.attrelid
    and d.adnum = a.attnum
  where a.attrelid = 'public.businesses'::regclass
    and a.attname = 'payment_method_mode'
    and not a.attisdropped;

  if not found
    or v_type <> 'text'::regtype
    or v_not_null is not true
    or v_default is distinct from '''cash''::text' then
    raise exception 'businesses.payment_method_mode has an incompatible definition';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_payment_method_mode_check'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
      add constraint businesses_payment_method_mode_check
      check (payment_method_mode in ('cash', 'card', 'cash_or_card'));
  end if;
end $$;

alter table public.orders
  add column if not exists payment_method text;

do $$
declare
  v_type oid;
  v_not_null boolean;
  v_has_default boolean;
begin
  select
    a.atttypid,
    a.attnotnull,
    d.oid is not null
  into
    v_type,
    v_not_null,
    v_has_default
  from pg_attribute a
  left join pg_attrdef d
    on d.adrelid = a.attrelid
    and d.adnum = a.attnum
  where a.attrelid = 'public.orders'::regclass
    and a.attname = 'payment_method'
    and not a.attisdropped;

  if not found
    or v_type <> 'text'::regtype
    or v_not_null is true
    or v_has_default is true then
    raise exception 'orders.payment_method has an incompatible definition';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_payment_method_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_method_check
      check (
        payment_method is null
        or payment_method in ('cash', 'card')
      );
  end if;
end $$;

-- Remove the exact legacy signature so calls that omit the new trailing
-- parameter resolve to the new function through its default value.
drop function if exists public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid
);

create or replace function public.create_order_with_items(
  p_business_slug text,
  p_order_type text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_note text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_payment_method text default null
)
returns table (
  order_number bigint,
  total_amount numeric(12,2),
  order_type text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_business record;
  v_item jsonb;
  v_item_quantity numeric;
  v_requested_count integer;
  v_matched_count integer;
  v_items_valid boolean;
  v_total_amount numeric(12,2);
  v_order_id uuid;
  v_business_order_number bigint;
  v_existing record;
  v_existing_found boolean;
  v_customer_address text;
  v_customer_note text;
  v_payment_method text;
  v_canonical_items jsonb;
  v_legacy_canonical_payload jsonb;
  v_canonical_payload jsonb;
  v_legacy_idempotency_payload_hash text;
  v_idempotency_payload_hash text;
begin
  if p_business_slug is null
    or nullif(btrim(p_business_slug), '') is null
    or char_length(p_business_slug) > 140 then
    raise exception 'invalid_business';
  end if;

  if p_order_type not in ('delivery', 'pickup') then
    raise exception 'invalid_order_type';
  end if;

  if p_customer_name is null
    or nullif(btrim(p_customer_name), '') is null
    or char_length(btrim(p_customer_name)) > 120 then
    raise exception 'invalid_customer_name';
  end if;

  if p_customer_phone is null
    or nullif(btrim(p_customer_phone), '') is null
    or char_length(btrim(p_customer_phone)) > 40 then
    raise exception 'invalid_customer_phone';
  end if;

  if p_customer_note is not null and char_length(btrim(p_customer_note)) > 600 then
    raise exception 'invalid_customer_note';
  end if;

  if p_order_type = 'delivery' then
    if p_customer_address is null
      or nullif(btrim(p_customer_address), '') is null
      or char_length(btrim(p_customer_address)) > 600 then
      raise exception 'invalid_delivery_address';
    end if;
    v_customer_address := btrim(p_customer_address);
  else
    v_customer_address := null;
  end if;

  v_customer_note := nullif(btrim(coalesce(p_customer_note, '')), '');

  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_data';
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_order_items';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ? 'product_id')
      or not (v_item ? 'quantity')
      or exists (
        select 1
        from jsonb_object_keys(v_item) as item_keys(key_name)
        where key_name not in ('product_id', 'quantity')
      )
      or jsonb_typeof(v_item->'product_id') <> 'string'
      or (v_item->>'product_id') !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or jsonb_typeof(v_item->'quantity') <> 'number' then
      raise exception 'invalid_order_items';
    end if;

    v_item_quantity := (v_item->>'quantity')::numeric;
    if v_item_quantity <> trunc(v_item_quantity)
      or v_item_quantity < 1
      or v_item_quantity > 99 then
      raise exception 'invalid_order_quantity';
    end if;
  end loop;

  select
    b.id,
    b.minimum_order_amount,
    b.is_active,
    b.subscription_status,
    b.subscription_expires_at,
    b.is_open,
    b.payment_method_mode
  into v_business
  from public.businesses b
  where b.slug = btrim(p_business_slug)
  for share;

  if not found then
    raise exception 'business_not_found';
  end if;

  with normalized_items as (
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as item
    group by (item->>'product_id')::uuid
  )
  select jsonb_agg(
    jsonb_build_object(
      'product_id',
      product_id::text,
      'quantity',
      quantity
    )
    order by product_id
  )
  into v_canonical_items
  from normalized_items;

  v_legacy_canonical_payload := jsonb_build_object(
    'version',
    1,
    'business_id',
    v_business.id::text,
    'order_type',
    p_order_type,
    'customer_name',
    btrim(p_customer_name),
    'customer_phone',
    btrim(p_customer_phone),
    'customer_address',
    v_customer_address,
    'customer_note',
    v_customer_note,
    'items',
    v_canonical_items
  );

  v_legacy_idempotency_payload_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_legacy_canonical_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select
    o.business_order_number,
    o.total_amount,
    o.order_type,
    o.payment_method,
    o.idempotency_payload_hash
  into v_existing
  from public.orders o
  where o.business_id = v_business.id
    and o.idempotency_key = p_idempotency_key
    and o.created_at >= now() - interval '24 hours';

  v_existing_found := found;

  if v_existing_found and v_existing.payment_method is null then
    if v_existing.idempotency_payload_hash <> v_legacy_idempotency_payload_hash then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;

    return query
    select
      v_existing.business_order_number::bigint,
      v_existing.total_amount::numeric(12,2),
      v_existing.order_type::text;
    return;
  end if;

  if p_payment_method is not null
    and p_payment_method not in ('cash', 'card') then
    raise exception 'invalid_payment_method';
  end if;

  if v_existing_found then
    v_payment_method := coalesce(p_payment_method, v_existing.payment_method);
  else
    if v_business.payment_method_mode = 'cash' then
      v_payment_method := coalesce(p_payment_method, 'cash');
      if v_payment_method <> 'cash' then
        raise exception 'payment_method_not_available';
      end if;
    elsif v_business.payment_method_mode = 'card' then
      v_payment_method := coalesce(p_payment_method, 'card');
      if v_payment_method <> 'card' then
        raise exception 'payment_method_not_available';
      end if;
    elsif v_business.payment_method_mode = 'cash_or_card' then
      if p_payment_method is null then
        raise exception 'invalid_payment_method';
      end if;
      v_payment_method := p_payment_method;
    else
      raise exception 'invalid_payment_configuration';
    end if;
  end if;

  v_canonical_payload := jsonb_build_object(
    'version',
    2,
    'business_id',
    v_business.id::text,
    'order_type',
    p_order_type,
    'customer_name',
    btrim(p_customer_name),
    'customer_phone',
    btrim(p_customer_phone),
    'customer_address',
    v_customer_address,
    'customer_note',
    v_customer_note,
    'items',
    v_canonical_items,
    'payment_method',
    v_payment_method
  );

  v_idempotency_payload_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_canonical_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  if v_existing_found then
    if v_existing.idempotency_payload_hash <> v_idempotency_payload_hash then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;

    return query
    select
      v_existing.business_order_number::bigint,
      v_existing.total_amount::numeric(12,2),
      v_existing.order_type::text;
    return;
  end if;

  if v_business.is_active is not true
    or v_business.subscription_status is distinct from 'active'
    or v_business.subscription_expires_at is null
    or v_business.subscription_expires_at <= now()
    or v_business.is_open is not true then
    raise exception 'business_not_available';
  end if;

  perform p.id
  from public.products p
  join (
    select distinct (item->>'product_id')::uuid as product_id
    from jsonb_array_elements(p_items) as item
  ) requested_products on requested_products.product_id = p.id
  for share of p;

  with normalized_items as (
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as item
    group by (item->>'product_id')::uuid
  ),
  matched_products as (
    select
      n.product_id,
      n.quantity,
      p.name,
      p.price
    from normalized_items n
    join public.products p
      on p.id = n.product_id
      and p.business_id = v_business.id
      and p.is_active = true
  )
  select
    (select count(*) from normalized_items),
    count(*),
    coalesce(
      bool_and(
        quantity between 1 and 99
        and price is not null
        and price >= 0
        and nullif(btrim(name), '') is not null
        and char_length(name) <= 180
      ),
      false
    ),
    coalesce(sum(price * quantity), 0)::numeric(12,2)
  into
    v_requested_count,
    v_matched_count,
    v_items_valid,
    v_total_amount
  from matched_products;

  if v_requested_count <> v_matched_count or not v_items_valid then
    raise exception 'products_not_available';
  end if;

  if coalesce(v_business.minimum_order_amount, 0) > 0
    and v_total_amount < v_business.minimum_order_amount then
    raise exception 'minimum_order_not_met';
  end if;

  update public.orders o
  set
    idempotency_key = null,
    idempotency_payload_hash = null
  where o.business_id = v_business.id
    and o.idempotency_key = p_idempotency_key
    and o.created_at < now() - interval '24 hours';

  insert into public.business_order_counters (
    business_id,
    next_order_number
  )
  select
    v_business.id,
    coalesce(max(o.business_order_number), 0)::bigint + 1
  from public.orders o
  where o.business_id = v_business.id
  on conflict (business_id) do nothing;

  perform 1
  from public.business_order_counters c
  where c.business_id = v_business.id
  for update;

  select
    o.business_order_number,
    o.total_amount,
    o.order_type,
    o.payment_method,
    o.idempotency_payload_hash
  into v_existing
  from public.orders o
  where o.business_id = v_business.id
    and o.idempotency_key = p_idempotency_key
    and o.created_at >= now() - interval '24 hours';

  if found then
    if (
      v_existing.payment_method is null
      and v_existing.idempotency_payload_hash <> v_legacy_idempotency_payload_hash
    ) or (
      v_existing.payment_method is not null
      and v_existing.idempotency_payload_hash <> v_idempotency_payload_hash
    ) then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;

    return query
    select
      v_existing.business_order_number::bigint,
      v_existing.total_amount::numeric(12,2),
      v_existing.order_type::text;
    return;
  end if;

  update public.business_order_counters c
  set next_order_number = c.next_order_number + 1
  where c.business_id = v_business.id
  returning c.next_order_number - 1
  into v_business_order_number;

  if v_business_order_number is null or v_business_order_number < 1 then
    raise exception 'invalid_order_counter';
  end if;

  insert into public.orders (
    business_id,
    business_order_number,
    status,
    order_type,
    payment_method,
    customer_name,
    customer_phone,
    customer_address,
    customer_note,
    total_amount,
    currency,
    idempotency_key,
    idempotency_payload_hash
  )
  values (
    v_business.id,
    v_business_order_number,
    'new',
    p_order_type,
    v_payment_method,
    btrim(p_customer_name),
    btrim(p_customer_phone),
    v_customer_address,
    v_customer_note,
    v_total_amount,
    'TRY',
    p_idempotency_key,
    v_idempotency_payload_hash
  )
  on conflict (business_id, idempotency_key) do nothing
  returning
    id,
    public.orders.business_order_number
  into
    v_order_id,
    v_business_order_number;

  if not found then
    select
      o.business_order_number,
      o.total_amount,
      o.order_type,
      o.payment_method,
      o.idempotency_payload_hash
    into v_existing
    from public.orders o
    where o.business_id = v_business.id
      and o.idempotency_key = p_idempotency_key
      and o.created_at >= now() - interval '24 hours';

    if not found then
      raise exception 'idempotency_conflict';
    end if;

    if (
      v_existing.payment_method is null
      and v_existing.idempotency_payload_hash <> v_legacy_idempotency_payload_hash
    ) or (
      v_existing.payment_method is not null
      and v_existing.idempotency_payload_hash <> v_idempotency_payload_hash
    ) then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;

    return query
    select
      v_existing.business_order_number::bigint,
      v_existing.total_amount::numeric(12,2),
      v_existing.order_type::text;
    return;
  end if;

  insert into public.order_items (
    order_id,
    product_id,
    product_name,
    unit_price,
    quantity,
    line_total
  )
  select
    v_order_id,
    p.id,
    p.name,
    p.price,
    n.quantity,
    (p.price * n.quantity)::numeric(12,2)
  from (
    select
      (item->>'product_id')::uuid as product_id,
      sum((item->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) as item
    group by (item->>'product_id')::uuid
  ) n
  join public.products p
    on p.id = n.product_id
    and p.business_id = v_business.id
    and p.is_active = true;

  return query
  select
    v_business_order_number,
    v_total_amount,
    p_order_type;
end;
$$;

revoke all on function public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text
) from public;
revoke execute on function public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text
) from anon;
revoke execute on function public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text
) from authenticated;
grant execute on function public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid,
  text
) to service_role;

commit;
