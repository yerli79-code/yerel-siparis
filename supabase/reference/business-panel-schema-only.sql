-- REFERENCE ONLY — DO NOT RUN WITHOUT REVIEW
-- This file contains historical schema preparation SQL only.
-- It is not a complete fresh database migration and may not match the current
-- profiles/businesses ownership model.

-- Business panel schema-only migration.
-- Safe first step: add missing columns only.
-- No RLS policies, triggers, indexes, or table creation in this file.
-- Existing columns are not modified.
-- public.products is assumed to already exist.

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

alter table public.products
add column if not exists description text;

alter table public.products
add column if not exists category text;

alter table public.products
add column if not exists image_url text;
