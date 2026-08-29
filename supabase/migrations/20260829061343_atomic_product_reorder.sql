begin;

create or replace function public.reorder_business_products_atomic(
  p_business_id uuid,
  p_items jsonb
)
returns setof public.products
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_requested_count integer;
  v_locked_count integer := 0;
  v_locked_product record;
begin
  if p_business_id is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PRODUCT_MUTATION';
  end if;

  v_requested_count := jsonb_array_length(p_items);
  if v_requested_count < 2 or v_requested_count > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PRODUCT_MUTATION';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as requested(item)
    where jsonb_typeof(requested.item) <> 'object'
      or not requested.item ?& array[
        'productId',
        'sortOrder',
        'expectedUpdatedAt'
      ]
      or jsonb_object_length(requested.item) <> 3
      or coalesce(requested.item ->> 'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(requested.item -> 'sortOrder') <> 'number'
      or (requested.item ->> 'sortOrder')::numeric <> trunc((requested.item ->> 'sortOrder')::numeric)
      or (requested.item ->> 'sortOrder')::numeric < 0
      or (requested.item ->> 'sortOrder')::numeric > 2147483647
      or coalesce(requested.item ->> 'expectedUpdatedAt', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PRODUCT_MUTATION';
  end if;

  if (
    select count(*) <> count(distinct requested.item ->> 'productId')
      or count(*) <> count(distinct (requested.item ->> 'sortOrder')::integer)
    from jsonb_array_elements(p_items) as requested(item)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'INVALID_PRODUCT_MUTATION';
  end if;

  for v_locked_product in
    select product.id
    from public.products as product
    join jsonb_to_recordset(p_items) as requested(
      "productId" text,
      "sortOrder" integer,
      "expectedUpdatedAt" timestamptz
    ) on product.id = requested."productId"::uuid
    where product.business_id = p_business_id
    order by product.id
    for update of product
  loop
    v_locked_count := v_locked_count + 1;
  end loop;

  if v_locked_count <> v_requested_count then
    raise exception using
      errcode = 'P0001',
      message = 'PRODUCT_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.products as product
    join jsonb_to_recordset(p_items) as requested(
      "productId" text,
      "sortOrder" integer,
      "expectedUpdatedAt" timestamptz
    ) on product.id = requested."productId"::uuid
    where product.business_id = p_business_id
      and product.updated_at is distinct from requested."expectedUpdatedAt"
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'PRODUCT_CONFLICT';
  end if;

  update public.products as product
  set sort_order = requested."sortOrder"
  from jsonb_to_recordset(p_items) as requested(
    "productId" text,
    "sortOrder" integer,
    "expectedUpdatedAt" timestamptz
  )
  where product.id = requested."productId"::uuid
    and product.business_id = p_business_id
    and product.sort_order is distinct from requested."sortOrder";

  return query
  select product.*
  from public.products as product
  join jsonb_to_recordset(p_items) as requested(
    "productId" text,
    "sortOrder" integer,
    "expectedUpdatedAt" timestamptz
  ) on product.id = requested."productId"::uuid
  where product.business_id = p_business_id
  order by product.sort_order, product.id;
end;
$function$;

revoke execute on function public.reorder_business_products_atomic(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.reorder_business_products_atomic(uuid, jsonb)
to service_role;

commit;
