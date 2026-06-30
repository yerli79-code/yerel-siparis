-- DEPRECATED — DO NOT RUN
-- This file contains historical SQL that may recreate stale product RLS policies
-- and weaken public product visibility rules.
-- Kept for historical reference only.

-- Business panel preparation migration.
-- This SQL is intentionally limited to safe schema preparation.
-- Storage bucket and Storage policies are not included in this phase.
--
-- Current Supabase check:
--   public.businesses.id exists and is uuid with default gen_random_uuid().
--   public.businesses.owner_id exists and is uuid.
--   public.products already exists.
--
-- IMPORTANT:
-- This migration does NOT create public.products.
-- It only adds missing columns with add column if not exists.
-- Existing product columns such as image_label are not removed or renamed.
--
-- Before running, still confirm the two unclear products columns:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'products'
--   order by ordinal_position;

alter table public.businesses
add column if not exists city text;

alter table public.businesses
add column if not exists latitude double precision;

alter table public.businesses
add column if not exists longitude double precision;

alter table public.businesses
add column if not exists service_radius_km numeric;

alter table public.businesses
add column if not exists owner_id uuid references auth.users(id) on delete set null;

alter table public.businesses
add column if not exists logo_url text;

alter table public.businesses
add column if not exists cover_image_url text;

-- public.products already exists.
-- The visible existing columns include:
-- id, business_id, client_product_id, name, price, image_label,
-- is_active, sort_order, created_at, updated_at.
-- The two unclear columns may already be description and category.
-- These add-column statements are safe if they already exist.

alter table public.products
add column if not exists description text;

alter table public.products
add column if not exists category text;

alter table public.products
add column if not exists image_url text;

-- The following indexes are safe to re-run.
-- Risk note: products_business_category_idx requires the category column.

create index if not exists products_business_id_idx
on public.products (business_id);

create index if not exists products_business_category_idx
on public.products (business_id, category);

create index if not exists products_business_active_idx
on public.products (business_id, is_active);

-- updated_at trigger is safe to recreate.
-- Risk note: public.products.updated_at must exist; it was confirmed visible.

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

-- RLS policies are recreated by name so this migration can be re-run safely.
-- Risk note: owner policies assume:
--   public.products.business_id references public.businesses.id
--   public.businesses.owner_id stores auth.users.id
--   public.businesses subscription columns already exist from admin migration.

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
