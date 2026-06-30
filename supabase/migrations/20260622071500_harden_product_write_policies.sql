-- Product writes remain client-driven temporarily, but are enforced by strict RLS.
-- An authenticated owner may write products only for an active business with an active, unexpired subscription.

begin;

drop policy if exists "Owners can insert own products" on public.products;
drop policy if exists "Owners can update own products" on public.products;
drop policy if exists "Owners can delete own products" on public.products;

revoke insert on public.products from anon;
revoke update on public.products from anon;
revoke delete on public.products from anon;

create policy "Owners can insert own products"
on public.products
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = products.business_id
      and b.owner_id = auth.uid()
      and b.is_active = true
      and b.subscription_status = 'active'
      and b.subscription_expires_at > now()
  )
);

create policy "Owners can update own products"
on public.products
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = products.business_id
      and b.owner_id = auth.uid()
      and b.is_active = true
      and b.subscription_status = 'active'
      and b.subscription_expires_at > now()
  )
)
with check (
  exists (
    select 1
    from public.businesses b
    where b.id = products.business_id
      and b.owner_id = auth.uid()
      and b.is_active = true
      and b.subscription_status = 'active'
      and b.subscription_expires_at > now()
  )
);

create policy "Owners can delete own products"
on public.products
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses b
    where b.id = products.business_id
      and b.owner_id = auth.uid()
      and b.is_active = true
      and b.subscription_status = 'active'
      and b.subscription_expires_at > now()
  )
);

commit;
