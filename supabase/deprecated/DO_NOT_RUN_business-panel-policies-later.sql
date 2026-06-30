-- DEPRECATED — DO NOT RUN
-- This deferred policy draft is obsolete and may recreate insecure or stale
-- product visibility policies.
-- Kept for historical reference only.

-- Bu dosya simdilik calistirilmayacak. Once businesses abonelik kolon adlari ve owner_id iliskisi dogrulanacak.
-- Business panel deferred policies/indexes/triggers.
-- Run only after confirming:
--   public.products.business_id references public.businesses.id
--   public.businesses.owner_id stores auth.users.id
--   public.businesses subscription columns are present and named:
--     is_active, subscription_status, subscription_expires_at

create index if not exists products_business_id_idx
on public.products (business_id);

create index if not exists products_business_category_idx
on public.products (business_id, category);

create index if not exists products_business_active_idx
on public.products (business_id, is_active);

create or replace function public.set_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row
execute function public.set_products_updated_at();

alter table public.products enable row level security;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
on public.products
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Business owners can read own products" on public.products;
create policy "Business owners can read own products"
on public.products
for select
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = auth.uid()
  )
);

drop policy if exists "Business owners can insert own products" on public.products;
create policy "Business owners can insert own products"
on public.products
for insert
to authenticated
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = auth.uid()
      and businesses.is_active = true
      and businesses.subscription_status = 'active'
      and (
        businesses.subscription_expires_at is null
        or businesses.subscription_expires_at > now()
      )
  )
);

drop policy if exists "Business owners can update own products" on public.products;
create policy "Business owners can update own products"
on public.products
for update
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = auth.uid()
      and businesses.is_active = true
      and businesses.subscription_status = 'active'
      and (
        businesses.subscription_expires_at is null
        or businesses.subscription_expires_at > now()
      )
  )
);

drop policy if exists "Business owners can delete own products" on public.products;
create policy "Business owners can delete own products"
on public.products
for delete
to authenticated
using (
  exists (
    select 1
    from public.businesses
    where businesses.id = products.business_id
      and businesses.owner_id = auth.uid()
  )
);

notify pgrst, 'reload schema';
