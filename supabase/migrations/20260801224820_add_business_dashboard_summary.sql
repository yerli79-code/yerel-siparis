begin;

create or replace function public.get_business_dashboard_summary(
  p_business_id uuid,
  p_date date
)
returns table (
  range_start timestamptz,
  range_end_exclusive timestamptz,
  total_orders bigint,
  new_orders bigint,
  pending_orders bigint,
  delivered_orders bigint,
  cancelled_orders bigint,
  all_currency_try boolean,
  delivered_revenue numeric
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with bounds as (
    select
      p_date::timestamp at time zone 'Europe/Istanbul' as range_start,
      (p_date + 1)::timestamp at time zone 'Europe/Istanbul'
        as range_end_exclusive
  )
  select
    bounds.range_start,
    bounds.range_end_exclusive,
    count(orders.id)::bigint as total_orders,
    count(orders.id) filter (where orders.status = 'new')::bigint
      as new_orders,
    count(orders.id) filter (
      where orders.status in ('new', 'preparing', 'ready')
    )::bigint as pending_orders,
    count(orders.id) filter (where orders.status = 'delivered')::bigint
      as delivered_orders,
    count(orders.id) filter (where orders.status = 'cancelled')::bigint
      as cancelled_orders,
    count(orders.id) filter (
      where orders.currency is distinct from 'TRY'
    ) = 0 as all_currency_try,
    coalesce(
      sum(orders.total_amount) filter (where orders.status = 'delivered'),
      0::numeric
    ) as delivered_revenue
  from bounds
  left join public.orders as orders
    on orders.business_id = p_business_id
    and orders.created_at >= bounds.range_start
    and orders.created_at < bounds.range_end_exclusive
  group by bounds.range_start, bounds.range_end_exclusive;
$$;

revoke execute on function public.get_business_dashboard_summary(uuid, date)
  from public;
revoke execute on function public.get_business_dashboard_summary(uuid, date)
  from anon;
revoke execute on function public.get_business_dashboard_summary(uuid, date)
  from authenticated;
grant execute on function public.get_business_dashboard_summary(uuid, date)
  to service_role;

commit;
