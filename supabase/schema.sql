-- Yerel Siparis Supabase schema
-- Run this first in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text not null default '',
  role text not null default 'business_owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete cascade,
  slug text not null unique,
  name text not null,
  description text not null default '',
  whatsapp_order_number text not null default '',
  category text not null default 'Genel',
  city text not null default '',
  district text not null default '',
  neighborhood text not null default '',
  address text not null default '',
  delivery_status text not null default 'Teslimat bilgisi eklenmedi',
  logo_text text not null default '',
  cover_image text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_product_id text not null default '',
  name text not null,
  price numeric(10, 2) not null check (price >= 0),
  category text not null default 'Genel',
  description text not null default '',
  image_label text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists businesses_owner_id_idx on public.businesses(owner_id);
create index if not exists businesses_slug_idx on public.businesses(slug);
create index if not exists businesses_is_active_idx on public.businesses(is_active);
create index if not exists products_business_id_idx on public.products(business_id);
create index if not exists products_client_product_id_idx on public.products(client_product_id);
create index if not exists products_is_active_idx on public.products(is_active);
create index if not exists products_category_idx on public.products(category);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
before update on public.businesses
for each row execute function public.set_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();
