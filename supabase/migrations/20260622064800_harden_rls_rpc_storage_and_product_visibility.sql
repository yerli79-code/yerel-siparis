begin;


-- A1) Remove legacy insecure subscription update policy on businesses.
drop policy if exists "Admin demo can update subscriptions" on public.businesses;


-- A2) Remove legacy broad public businesses read policy.
drop policy if exists "Public can read businesses" on public.businesses;


-- A3) Recreate strict public businesses read policy.
-- Public users can only read active businesses with an active, non-expired subscription.
drop policy if exists "Public can read active subscribed businesses" on public.businesses;

create policy "Public can read active subscribed businesses"
on public.businesses
for select
to anon, authenticated
using (
  is_active = true
  and subscription_status = 'active'
  and subscription_expires_at > now()
);


-- B1) Remove legacy loose public products read policy.
drop policy if exists "Public can read active products" on public.products;


-- B2) Recreate strict public products read policy.
-- Public users can only read active products of active, subscribed businesses.
drop policy if exists "Public can read active products of active subscribed businesses" on public.products;

create policy "Public can read active products of active subscribed businesses"
on public.products
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.businesses b
    where b.id = products.business_id
      and b.is_active = true
      and b.subscription_status = 'active'
      and b.subscription_expires_at > now()
  )
);


-- C1) Revoke public/client execute permissions from all admin subscription RPC signatures.
-- service_role and postgres permissions are intentionally left unchanged.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as function_identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_update_business_subscription'
  loop
    execute format('revoke execute on function %s from public', fn.function_identity);
    execute format('revoke execute on function %s from anon', fn.function_identity);
    execute format('revoke execute on function %s from authenticated', fn.function_identity);
  end loop;
end $$;


-- D1) Remove legacy product-images write policies without owner checks.
drop policy if exists "Authenticated users can upload product images" on storage.objects;
drop policy if exists "Authenticated users can update product images" on storage.objects;
drop policy if exists "Authenticated users can delete product images" on storage.objects;


-- D2) Remove legacy business-images write policies without owner checks.
drop policy if exists "Authenticated users can upload business images" on storage.objects;
drop policy if exists "Authenticated users can update business images" on storage.objects;
drop policy if exists "Authenticated users can delete business images" on storage.objects;


-- D3) product-images INSERT: owners can upload only into their own business folder.
-- Expected object name format: {businessId}/{fileName}
drop policy if exists "Owner can upload product images" on storage.objects;

create policy "Owner can upload product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
);


-- D4) product-images UPDATE: owners can update only objects in their own business folder.
-- Expected object name format: {businessId}/{fileName}
drop policy if exists "Owner can update product images" on storage.objects;

create policy "Owner can update product images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
);


-- D5) product-images DELETE: owners can delete only objects in their own business folder.
-- Expected object name format: {businessId}/{fileName}
drop policy if exists "Owner can delete product images" on storage.objects;

create policy "Owner can delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
);


-- D6) business-images INSERT: owners can upload only into their own logo/cover folder.
-- Expected object name format: {businessId}/logo/{fileName} or {businessId}/cover/{fileName}
drop policy if exists "Owner can upload business images" on storage.objects;

create policy "Owner can upload business images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'business-images'
  and split_part(name, '/', 2) in ('logo', 'cover')
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
);


-- D7) business-images UPDATE: owners can update only their own logo/cover objects.
-- Expected object name format: {businessId}/logo/{fileName} or {businessId}/cover/{fileName}
drop policy if exists "Owner can update business images" on storage.objects;

create policy "Owner can update business images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'business-images'
  and split_part(name, '/', 2) in ('logo', 'cover')
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
)
with check (
  bucket_id = 'business-images'
  and split_part(name, '/', 2) in ('logo', 'cover')
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
);


-- D8) business-images DELETE: owners can delete only their own logo/cover objects.
-- Expected object name format: {businessId}/logo/{fileName} or {businessId}/cover/{fileName}
drop policy if exists "Owner can delete business images" on storage.objects;

create policy "Owner can delete business images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'business-images'
  and split_part(name, '/', 2) in ('logo', 'cover')
  and exists (
    select 1
    from public.businesses b
    where b.id::text = split_part(name, '/', 1)
      and b.owner_id = auth.uid()
  )
);


commit;
