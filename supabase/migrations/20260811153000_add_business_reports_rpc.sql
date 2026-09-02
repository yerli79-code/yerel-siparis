-- Server-only, PII-free operational report aggregate for one business.

begin;

create or replace function public.get_business_report(
  p_business_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_business_name text;
  v_range_start timestamptz;
  v_range_end_exclusive timestamptz;
  v_report jsonb;
begin
  if p_business_id is null or p_from is null or p_to is null then
    raise exception 'invalid_report_parameters';
  end if;

  if p_from > p_to or (p_to - p_from) > 179 then
    raise exception 'invalid_report_range';
  end if;

  select b.name
  into v_business_name
  from public.businesses as b
  where b.id = p_business_id;

  if not found then
    raise exception 'business_not_found';
  end if;

  v_range_start := p_from::timestamp at time zone 'Europe/Istanbul';
  v_range_end_exclusive :=
    (p_to + 1)::timestamp at time zone 'Europe/Istanbul';

  if exists (
    select 1
    from public.orders as o
    where o.business_id = p_business_id
      and o.created_at >= v_range_start
      and o.created_at < v_range_end_exclusive
      and o.currency is distinct from 'TRY'
  ) then
    raise exception 'unsupported_currency';
  end if;

  with report_orders as materialized (
    select
      o.id,
      o.status,
      o.order_type,
      o.payment_method,
      o.total_amount,
      o.created_at
    from public.orders as o
    where o.business_id = p_business_id
      and o.created_at >= v_range_start
      and o.created_at < v_range_end_exclusive
  ),
  delivered_orders as materialized (
    select *
    from report_orders
    where status = 'delivered'
  ),
  kpi_values as (
    select
      count(*)::bigint as total_orders,
      count(*) filter (where status = 'delivered')::bigint
        as completed_orders,
      count(*) filter (where status = 'cancelled')::bigint
        as cancelled_orders,
      coalesce(
        sum(total_amount) filter (where status = 'delivered'),
        0::numeric
      ) as completed_sales
    from report_orders
  ),
  sold_item_values as (
    select coalesce(sum(oi.quantity), 0)::bigint as sold_item_quantity
    from delivered_orders as delivered
    join public.order_items as oi on oi.order_id = delivered.id
  ),
  day_series as (
    select (p_from + day_offset)::date as report_date
    from generate_series(0, p_to - p_from) as day_offset
  ),
  daily_rollup as (
    select
      (o.created_at at time zone 'Europe/Istanbul')::date as report_date,
      count(*)::bigint as total_orders,
      count(*) filter (where o.status = 'delivered')::bigint
        as completed_orders,
      coalesce(
        sum(o.total_amount) filter (where o.status = 'delivered'),
        0::numeric
      ) as completed_sales
    from report_orders as o
    group by (o.created_at at time zone 'Europe/Istanbul')::date
  ),
  daily_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', days.report_date::text,
          'totalOrders', coalesce(rollup.total_orders, 0),
          'completedOrders', coalesce(rollup.completed_orders, 0),
          'completedSales', to_char(
            round(coalesce(rollup.completed_sales, 0), 2),
            'FM999999999999999999999999990.00'
          )
        )
        order by days.report_date
      ),
      '[]'::jsonb
    ) as value
    from day_series as days
    left join daily_rollup as rollup using (report_date)
  ),
  delivered_item_rows as (
    select
      oi.id as item_id,
      oi.order_id,
      oi.product_id,
      oi.product_name,
      oi.quantity,
      oi.line_total,
      oi.created_at as item_created_at,
      delivered.created_at as order_created_at,
      lower(
        regexp_replace(btrim(oi.product_name), '[[:space:]]+', ' ', 'g')
      ) as normalized_name
    from delivered_orders as delivered
    join public.order_items as oi on oi.order_id = delivered.id
  ),
  product_identity_rows as (
    select
      case
        when item.product_id is not null
          then 'product:' || lower(item.product_id::text)
        else 'legacy:' || pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(item.normalized_name, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      end as logical_key,
      item.*
    from delivered_item_rows as item
  ),
  product_rollup as (
    select
      item.logical_key,
      item.product_id,
      (
        array_agg(
          item.product_name
          order by
            item.order_created_at desc,
            item.item_created_at desc,
            item.item_id desc
        )
      )[1] as display_name,
      sum(item.quantity)::bigint as quantity,
      count(distinct item.order_id)::bigint as order_count,
      coalesce(sum(item.line_total), 0::numeric) as revenue
    from product_identity_rows as item
    group by item.logical_key, item.product_id
  ),
  product_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', product.logical_key,
          'productId', product.product_id,
          'name', product.display_name,
          'quantity', product.quantity,
          'orderCount', product.order_count,
          'revenue', to_char(
            round(product.revenue, 2),
            'FM999999999999999999999999990.00'
          ),
          'sharePercent', case
            when kpi.completed_sales = 0 then 0::numeric
            else round(product.revenue * 100 / kpi.completed_sales, 2)
          end
        )
        order by
          product.revenue desc,
          product.quantity desc,
          product.logical_key collate "C"
      ),
      '[]'::jsonb
    ) as value
    from product_rollup as product
    cross join kpi_values as kpi
  ),
  payment_buckets(method, label, sort_order) as (
    values
      ('cash'::text, 'Nakit'::text, 1),
      ('card'::text, 'Kart'::text, 2),
      ('unknown'::text, 'Belirtilmemiş'::text, 3)
  ),
  payment_rollup as (
    select
      coalesce(delivered.payment_method, 'unknown') as method,
      count(*)::bigint as order_count,
      coalesce(sum(delivered.total_amount), 0::numeric) as revenue
    from delivered_orders as delivered
    group by coalesce(delivered.payment_method, 'unknown')
  ),
  payment_json as (
    select jsonb_agg(
      jsonb_build_object(
        'method', bucket.method,
        'label', bucket.label,
        'orderCount', coalesce(rollup.order_count, 0),
        'revenue', to_char(
          round(coalesce(rollup.revenue, 0), 2),
          'FM999999999999999999999999990.00'
        ),
        'sharePercent', case
          when kpi.completed_sales = 0 then 0::numeric
          else round(coalesce(rollup.revenue, 0) * 100 / kpi.completed_sales, 2)
        end
      )
      order by bucket.sort_order
    ) as value
    from payment_buckets as bucket
    left join payment_rollup as rollup using (method)
    cross join kpi_values as kpi
  ),
  order_type_buckets(order_type, label, sort_order) as (
    values
      ('delivery'::text, 'Teslimat'::text, 1),
      ('pickup'::text, 'Gel-al'::text, 2)
  ),
  order_type_rollup as (
    select
      delivered.order_type,
      count(*)::bigint as order_count,
      coalesce(sum(delivered.total_amount), 0::numeric) as revenue
    from delivered_orders as delivered
    group by delivered.order_type
  ),
  order_type_json as (
    select jsonb_agg(
      jsonb_build_object(
        'type', bucket.order_type,
        'label', bucket.label,
        'orderCount', coalesce(rollup.order_count, 0),
        'revenue', to_char(
          round(coalesce(rollup.revenue, 0), 2),
          'FM999999999999999999999999990.00'
        ),
        'sharePercent', case
          when kpi.completed_sales = 0 then 0::numeric
          else round(coalesce(rollup.revenue, 0) * 100 / kpi.completed_sales, 2)
        end
      )
      order by bucket.sort_order
    ) as value
    from order_type_buckets as bucket
    left join order_type_rollup as rollup using (order_type)
    cross join kpi_values as kpi
  ),
  status_buckets(status, sort_order) as (
    values
      ('new'::text, 1),
      ('preparing'::text, 2),
      ('ready'::text, 3),
      ('delivered'::text, 4),
      ('cancelled'::text, 5)
  ),
  status_rollup as (
    select o.status, count(*)::bigint as order_count
    from report_orders as o
    group by o.status
  ),
  status_json as (
    select jsonb_agg(
      jsonb_build_object(
        'status', bucket.status,
        'count', coalesce(rollup.order_count, 0),
        'sharePercent', case
          when kpi.total_orders = 0 then 0::numeric
          else round(coalesce(rollup.order_count, 0) * 100 / kpi.total_orders, 2)
        end
      )
      order by bucket.sort_order
    ) as value
    from status_buckets as bucket
    left join status_rollup as rollup using (status)
    cross join kpi_values as kpi
  )
  select jsonb_build_object(
    'schemaVersion', 1,
    'business', jsonb_build_object('name', v_business_name),
    'period', jsonb_build_object(
      'from', p_from::text,
      'to', p_to::text,
      'timezone', 'Europe/Istanbul',
      'rangeStart', v_range_start,
      'rangeEndExclusive', v_range_end_exclusive,
      'generatedAt', current_timestamp
    ),
    'currency', 'TRY',
    'kpis', jsonb_build_object(
      'totalOrders', kpi.total_orders,
      'completedOrders', kpi.completed_orders,
      'cancelledOrders', kpi.cancelled_orders,
      'completedSales', to_char(
        round(kpi.completed_sales, 2),
        'FM999999999999999999999999990.00'
      ),
      'averageOrderValue', case
        when kpi.completed_orders = 0 then null
        else to_jsonb(
          to_char(
            round(kpi.completed_sales / kpi.completed_orders, 2),
            'FM999999999999999999999999990.00'
          )
        )
      end,
      'soldItemQuantity', sold_items.sold_item_quantity
    ),
    'daily', daily.value,
    'products', products.value,
    'payments', payments.value,
    'orderTypes', order_types.value,
    'statuses', statuses.value
  )
  into v_report
  from kpi_values as kpi
  cross join sold_item_values as sold_items
  cross join daily_json as daily
  cross join product_json as products
  cross join payment_json as payments
  cross join order_type_json as order_types
  cross join status_json as statuses;

  return v_report;
end;
$$;

-- Deleted products have no immutable historical identity once product_id is null.
-- Equal normalized snapshot names therefore merge by design. SHA-256 keeps the
-- fallback key deterministic without exposing the raw snapshot name and makes
-- accidental collisions negligible; a future snapshot identity would be needed
-- to distinguish two deleted products that truly shared the same normalized name.

revoke execute on function public.get_business_report(uuid, date, date)
  from public;
revoke execute on function public.get_business_report(uuid, date, date)
  from anon;
revoke execute on function public.get_business_report(uuid, date, date)
  from authenticated;
grant execute on function public.get_business_report(uuid, date, date)
  to service_role;

commit;
