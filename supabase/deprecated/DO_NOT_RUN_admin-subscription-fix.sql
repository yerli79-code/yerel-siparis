-- DEPRECATED — DO NOT RUN
-- This file contains historical SQL that may re-enable insecure
-- public business reads, direct client business writes, and public RPC execution.
-- Kept for historical reference only.

-- Admin manual subscription fix.
-- This SQL is idempotent and can be run more than once.

alter table public.businesses
add column if not exists subscription_status text;

alter table public.businesses
add column if not exists subscription_started_at timestamptz;

alter table public.businesses
add column if not exists subscription_expires_at timestamptz;

alter table public.businesses
add column if not exists is_active boolean;

alter table public.businesses
add column if not exists updated_at timestamptz;

alter table public.businesses
alter column subscription_status set default 'expired';

alter table public.businesses
alter column subscription_started_at drop default;

alter table public.businesses
alter column subscription_started_at drop not null;

alter table public.businesses
alter column subscription_expires_at drop default;

alter table public.businesses
alter column subscription_expires_at drop not null;

alter table public.businesses
alter column is_active set default false;

alter table public.businesses
alter column updated_at set default now();

update public.businesses
set
  subscription_status = coalesce(subscription_status, 'expired'),
  is_active = coalesce(is_active, false),
  updated_at = coalesce(updated_at, now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'businesses_subscription_status_check'
      and conrelid = 'public.businesses'::regclass
  ) then
    alter table public.businesses
    add constraint businesses_subscription_status_check
    check (subscription_status in ('active', 'expired', 'blocked'));
  end if;
end $$;

alter table public.businesses enable row level security;

grant select, update on public.businesses to anon;
grant select, update on public.businesses to authenticated;

drop policy if exists "Public can read businesses" on public.businesses;
drop policy if exists "Public can read active businesses" on public.businesses;
create policy "Public can read businesses"
on public.businesses
for select
to anon, authenticated
using (true);

drop policy if exists "Admin demo can update subscriptions" on public.businesses;
create policy "Admin demo can update subscriptions"
on public.businesses
for update
to anon, authenticated
using (true)
with check (true);

create or replace function public.admin_update_business_subscription(
  p_slug text,
  p_subscription_status text,
  p_subscription_started_at timestamptz,
  p_subscription_expires_at timestamptz,
  p_is_active boolean
)
returns public.businesses
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_business public.businesses;
begin
  if p_subscription_status not in ('active', 'expired', 'blocked') then
    raise exception 'Invalid subscription status: %', p_subscription_status;
  end if;

  update public.businesses
  set
    subscription_status = p_subscription_status,
    subscription_started_at = p_subscription_started_at,
    subscription_expires_at = p_subscription_expires_at,
    is_active = p_is_active,
    updated_at = now()
  where slug = p_slug
  returning * into updated_business;

  if updated_business is null then
    raise exception 'Business not found for slug: %', p_slug;
  end if;

  return updated_business;
end;
$$;

grant execute on function public.admin_update_business_subscription(
  text,
  text,
  timestamptz,
  timestamptz,
  boolean
) to anon, authenticated;

notify pgrst, 'reload schema';
