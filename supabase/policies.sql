-- Yerel Siparis Supabase RLS policies
-- Run this after supabase/schema.sql in Supabase SQL Editor.

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.products enable row level security;

grant select on public.businesses to anon;
grant select on public.products to anon;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.businesses to authenticated;
grant select, insert, update, delete on public.products to authenticated;

drop policy if exists "Public can read active businesses" on public.businesses;
create policy "Public can read active businesses"
on public.businesses
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Owners can read own businesses" on public.businesses;
create policy "Owners can read own businesses"
on public.businesses
for select
to authenticated
using ((select auth.uid()) is not null and owner_id = (select auth.uid()));

drop policy if exists "Owners can insert own business" on public.businesses;
create policy "Owners can insert own business"
on public.businesses
for insert
to authenticated
with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

drop policy if exists "Owners can update own business" on public.businesses;
create policy "Owners can update own business"
on public.businesses
for update
to authenticated
using ((select auth.uid()) is not null and owner_id = (select auth.uid()))
with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

drop policy if exists "Owners can delete own business" on public.businesses;
create policy "Owners can delete own business"
on public.businesses
for delete
to authenticated
using ((select auth.uid()) is not null and owner_id = (select auth.uid()));

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) is not null and id = (select auth.uid()))
with check ((select auth.uid()) is not null and id = (select auth.uid()));

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
on public.products
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.is_active = true
  )
);

drop policy if exists "Owners can read own products" on public.products;
create policy "Owners can read own products"
on public.products
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = (select auth.uid())
  )
);

drop policy if exists "Owners can insert own products" on public.products;
create policy "Owners can insert own products"
on public.products
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = (select auth.uid())
  )
);

drop policy if exists "Owners can update own products" on public.products;
create policy "Owners can update own products"
on public.products
for update
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = (select auth.uid())
  )
)
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = (select auth.uid())
  )
);

drop policy if exists "Owners can delete own products" on public.products;
create policy "Owners can delete own products"
on public.products
for delete
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = (select auth.uid())
  )
);
