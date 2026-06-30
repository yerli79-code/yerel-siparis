-- First version order management for business panels.
-- Public customers and business owners use server routes; direct table access is revoked.

begin;

do $$
declare
  pgcrypto_schema text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron extension is required before creating order retention job.';
  end if;

  select n.nspname
  into pgcrypto_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required before creating order idempotency hash.';
  end if;

  if pgcrypto_schema <> 'extensions' then
    raise exception 'pgcrypto extension must be installed in the extensions schema.';
  end if;
end $$;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null default 'new',
  order_type text not null,
  customer_name text not null,
  customer_phone text not null,
  customer_address text null,
  customer_note text null,
  total_amount numeric(12,2) not null,
  currency text not null default 'TRY',
  idempotency_key uuid null,
  idempotency_payload_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (
    status in ('new', 'preparing', 'ready', 'delivered', 'cancelled')
  ),
  constraint orders_order_type_check check (
    order_type in ('delivery', 'pickup')
  ),
  constraint orders_total_amount_check check (total_amount >= 0),
  constraint orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint orders_delivery_address_check check (
    (order_type = 'delivery' and nullif(btrim(customer_address), '') is not null)
    or
    (order_type = 'pickup' and customer_address is null)
  ),
  constraint orders_customer_name_check check (
    nullif(btrim(customer_name), '') is not null
    and char_length(customer_name) <= 120
  ),
  constraint orders_customer_phone_check check (
    nullif(btrim(customer_phone), '') is not null
    and char_length(customer_phone) <= 40
  ),
  constraint orders_customer_address_length_check check (
    customer_address is null or char_length(customer_address) <= 600
  ),
  constraint orders_customer_note_length_check check (
    customer_note is null or char_length(customer_note) <= 600
  ),
  constraint orders_idempotency_pair_check check (
    (idempotency_key is null and idempotency_payload_hash is null)
    or
    (
      idempotency_key is not null
      and idempotency_payload_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  constraint orders_business_idempotency_key_unique unique (
    business_id,
    idempotency_key
  )
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  product_name text not null,
  unit_price numeric(12,2) not null,
  quantity integer not null,
  line_total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint order_items_unit_price_check check (unit_price >= 0),
  constraint order_items_quantity_check check (quantity between 1 and 99),
  constraint order_items_line_total_check check (line_total >= 0),
  constraint order_items_product_name_check check (
    nullif(btrim(product_name), '') is not null
    and char_length(product_name) <= 180
  )
);

create index if not exists orders_business_created_at_idx
  on public.orders (business_id, created_at desc);

create index if not exists orders_business_status_created_at_idx
  on public.orders (business_id, status, created_at desc);

create index if not exists orders_idempotency_cleanup_idx
  on public.orders (created_at)
  where idempotency_key is not null;

create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create or replace function public.set_order_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (
    to_jsonb(new) - 'idempotency_key' - 'idempotency_payload_hash' - 'updated_at'
  ) is distinct from (
    to_jsonb(old) - 'idempotency_key' - 'idempotency_payload_hash' - 'updated_at'
  ) then
    new.updated_at = now();
  else
    new.updated_at = old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists set_orders_updated_at on public.orders;

create trigger set_orders_updated_at
before update on public.orders
for each row
execute function public.set_order_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all privileges on table public.orders from public, anon, authenticated;
revoke all privileges on table public.order_items from public, anon, authenticated;
revoke all privileges on sequence public.orders_order_number_seq
  from public, anon, authenticated;

grant select, insert, update, delete on table public.orders to service_role;
grant select, insert, update, delete on table public.order_items to service_role;
grant usage, select on sequence public.orders_order_number_seq to service_role;

create or replace function public.create_order_with_items(
  p_business_slug text,
  p_order_type text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_note text,
  p_items jsonb,
  p_idempotency_key uuid
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
  v_order_number bigint;
  v_existing record;
  v_customer_address text;
  v_customer_note text;
  v_canonical_items jsonb;
  v_canonical_payload jsonb;
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
    b.is_open
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

  v_canonical_payload := jsonb_build_object(
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

  v_idempotency_payload_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_canonical_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select
    o.order_number,
    o.total_amount,
    o.order_type,
    o.idempotency_payload_hash
  into v_existing
  from public.orders o
  where o.business_id = v_business.id
    and o.idempotency_key = p_idempotency_key
    and o.created_at >= now() - interval '24 hours';

  if found then
    if v_existing.idempotency_payload_hash <> v_idempotency_payload_hash then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;

    return query
    select
      v_existing.order_number::bigint,
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

  insert into public.orders (
    business_id,
    status,
    order_type,
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
    'new',
    p_order_type,
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
    public.orders.order_number
  into
    v_order_id,
    v_order_number;

  if not found then
    select
      o.order_number,
      o.total_amount,
      o.order_type,
      o.idempotency_payload_hash
    into v_existing
    from public.orders o
    where o.business_id = v_business.id
      and o.idempotency_key = p_idempotency_key
      and o.created_at >= now() - interval '24 hours';

    if not found then
      raise exception 'idempotency_conflict';
    end if;

    if v_existing.idempotency_payload_hash <> v_idempotency_payload_hash then
      raise exception 'idempotency_key_reused_with_different_payload';
    end if;

    return query
    select
      v_existing.order_number::bigint,
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
    v_order_number,
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
  uuid
) from public;
revoke execute on function public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid
) from anon;
revoke execute on function public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid
) from authenticated;
grant execute on function public.create_order_with_items(
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  uuid
) to service_role;

create or replace function public.purge_expired_orders()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch_count integer;
  v_deleted_count integer := 0;
  v_batch_number integer := 0;
begin
  loop
    with expired_orders as (
      select o.id
      from public.orders o
      where o.created_at < now() - interval '180 days'
      order by o.created_at asc
      limit 5000
    ),
    deleted_orders as (
      delete from public.orders o
      using expired_orders e
      where o.id = e.id
      returning o.id
    )
    select count(*) into v_batch_count from deleted_orders;

    v_deleted_count := v_deleted_count + v_batch_count;
    v_batch_number := v_batch_number + 1;
    exit when v_batch_count < 5000 or v_batch_number >= 4;
  end loop;

  v_batch_number := 0;
  loop
    with expired_keys as (
      select o.id
      from public.orders o
      where o.created_at < now() - interval '24 hours'
        and o.idempotency_key is not null
      order by o.created_at asc
      limit 5000
    )
    update public.orders o
    set
      idempotency_key = null,
      idempotency_payload_hash = null
    from expired_keys e
    where o.id = e.id;

    get diagnostics v_batch_count = row_count;
    v_batch_number := v_batch_number + 1;
    exit when v_batch_count < 5000 or v_batch_number >= 4;
  end loop;

  return v_deleted_count;
end;
$$;

revoke all on function public.purge_expired_orders() from public;
revoke execute on function public.purge_expired_orders() from anon;
revoke execute on function public.purge_expired_orders() from authenticated;
grant execute on function public.purge_expired_orders() to postgres;
grant execute on function public.purge_expired_orders() to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'purge_orders_after_180_days'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end $$;

select cron.schedule(
  'purge_orders_after_180_days',
  '17 * * * *',
  'select public.purge_expired_orders();'
);

commit;
