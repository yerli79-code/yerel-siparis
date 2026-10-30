\set ON_ERROR_STOP on

-- DISPOSABLE LOCAL TEST DATABASE ONLY. Never execute against production.
-- Invoke with: psql -v WHATSAPP_PRICE_CONSISTENCY_DISPOSABLE=1 -f supabase/tests/whatsapp-order-price-consistency-fixture.sql
\if :{?WHATSAPP_PRICE_CONSISTENCY_DISPOSABLE}
\else
  \echo 'WHATSAPP_PRICE_CONSISTENCY_DISPOSABLE=1 is required; refusing to run.'
  \quit
\endif
\if :WHATSAPP_PRICE_CONSISTENCY_DISPOSABLE
\else
  \echo 'WHATSAPP_PRICE_CONSISTENCY_DISPOSABLE must be truthy; refusing to run.'
  \quit
\endif

begin;

do $guard$
begin
  if current_database() <> 'postgres' then
    raise exception 'Disposable fixture check failed: expected database postgres, found %.', current_database();
  end if;

  if current_setting('cluster_name') <> 'whatsapp-price-consistency-disposable'
     or current_setting('data_directory') !~ '^/tmp/whatsapp-order-pgrst[.][^/]+/pgdata$' then
    raise exception 'Fixture requires the disposable cluster created by the CI runner.';
  end if;

  if to_regclass('public.businesses') is not null or to_regclass('auth.users') is not null then
    raise exception 'Fixture requires a fresh database; refusing to reuse existing application tables.';
  end if;

  if inet_server_addr() is not null then
    raise exception 'Disposable fixture check failed: connection must use a local unix socket (inet_server_addr = %).',
      inet_server_addr();
  end if;
end
$guard$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$roles$;

alter role anon with nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
alter role authenticated with nologin noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
alter role service_role with nologin noinherit nosuperuser nocreatedb nocreaterole bypassrls;
alter role authenticator with login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;

grant anon, authenticated, service_role to authenticator;

-- Model the October 30, 2026 opt-in API exposure rules in this fresh PG cluster.
-- Global defaults are distinct from additive per-schema defaults. In particular,
-- IN SCHEMA public REVOKE cannot remove PostgreSQL's global PUBLIC EXECUTE.
-- Keep the owner's privileges; remove only implicit API-role/PUBLIC access.
alter default privileges for role postgres
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- Probe effective permissions before any explicit GRANT, including PUBLIC inheritance.
-- No default-ACL row count can prove that new objects are inaccessible.
create table public.api_acl_probe (id integer);
alter table public.api_acl_probe enable row level security;
create sequence public.api_acl_probe_seq;
create function public.api_acl_probe_fn() returns integer language sql as 'select 1';

do $verify_new_object_defaults$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.api_acl_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       or has_sequence_privilege(v_role, 'public.api_acl_probe_seq', 'USAGE,SELECT,UPDATE')
       or has_function_privilege(v_role, 'public.api_acl_probe_fn()', 'EXECUTE') then
      raise exception 'Implicit API privileges remain for role %.', v_role;
    end if;
  end loop;
end
$verify_new_object_defaults$;

drop function public.api_acl_probe_fn();
drop sequence public.api_acl_probe_seq;
drop table public.api_acl_probe;

revoke all on schema public from public;
grant usage on schema public to anon, authenticated, service_role;

revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, service_role;

revoke all on schema storage from public;
grant usage on schema storage to anon, authenticated, service_role;

revoke all on schema extensions from public;
grant usage on schema extensions to service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    case
      when nullif(current_setting('request.jwt.claims', true), '') is not null
      then (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
      else null
    end
  )::uuid
$$;

revoke all on function auth.uid() from public;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  email text unique not null
);

revoke all privileges on table auth.users from public, anon, authenticated, service_role;

create table if not exists storage.objects (
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text not null,
  name text not null
);

alter table storage.objects enable row level security;
revoke all privileges on table storage.objects from public, anon, authenticated, service_role;

create table public.businesses (
  id uuid primary key,
  owner_id uuid references auth.users(id) on delete set null,
  name text not null,
  slug text unique not null,
  minimum_order_amount numeric default 0,
  is_open boolean not null default true,
  is_active boolean not null default true,
  subscription_status text not null default 'active',
  subscription_expires_at timestamptz default '2099-01-01T00:00:00Z',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null,
  is_active boolean not null default true,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.businesses enable row level security;
alter table public.products enable row level security;

revoke all privileges on table public.businesses from public, anon, authenticated, service_role;
revoke all privileges on table public.products from public, anon, authenticated, service_role;

-- Narrow table grants only (no GRANT ALL):
-- anon and authenticated can only SELECT eligible catalog rows via RLS.
-- service_role receives SELECT plus UPDATE required by PostgreSQL FOR SHARE row locks in SECURITY INVOKER create_order_with_items.
grant select on table public.businesses to anon, authenticated;
grant select on table public.products to anon, authenticated;
grant select, update on table public.businesses to service_role;
grant select, update on table public.products to service_role;

commit;

\i supabase/migrations/20260622064800_harden_rls_rpc_storage_and_product_visibility.sql
\i supabase/migrations/20260622070000_revoke_direct_business_writes.sql
\i supabase/migrations/20260622071500_harden_product_write_policies.sql
\i supabase/migrations/20260623090000_revoke_authenticated_direct_product_writes.sql
\i supabase/migrations/20260623100000_add_business_order_settings.sql
\i supabase/migrations/20260623103000_add_order_management.sql
\i supabase/migrations/20260623104000_add_business_order_numbers.sql
\i supabase/migrations/20260713100000_add_business_and_order_payment_methods.sql
\i supabase/migrations/20260901202413_public_order_rate_limit.sql

begin;

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-000000000001', 'synthetic-owner-primary@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'synthetic-owner-foreign@example.invalid');

insert into public.businesses (
  id,
  owner_id,
  name,
  slug,
  minimum_order_amount,
  is_open,
  is_active,
  subscription_status,
  subscription_expires_at,
  payment_method_mode
)
values
  (
    '33333333-3333-4333-8333-333333333333',
    '00000000-0000-4000-8000-000000000001',
    'Synthetic PostgREST Pilot',
    'local-postgrest-pilot',
    0,
    true,
    true,
    'active',
    '2099-01-01T00:00:00Z',
    'cash_or_card'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '00000000-0000-4000-8000-000000000002',
    'Synthetic Foreign Pilot',
    'foreign-postgrest-pilot',
    0,
    true,
    true,
    'active',
    '2099-01-01T00:00:00Z',
    'cash_or_card'
  );

insert into public.products (
  id,
  business_id,
  name,
  price,
  is_active,
  sort_order
)
values
  (
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    'Recorded Kebap',
    125.00,
    true,
    1
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    '33333333-3333-4333-8333-333333333333',
    'Recorded Ayran',
    10.25,
    true,
    2
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    'Foreign Kebap',
    95.00,
    true,
    1
  );

do $verify_acl_contract$
declare
  v_implicit_api_grants bigint;
  v_excess_grant_count bigint;
  v_table text;
begin
  -- Inspect ACL entries, scoped to this object's creator and BOTH global/public
  -- defaults. Restrictive global entries are expected and must not be rejected.
  select count(*) into v_implicit_api_grants
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) acl
  where d.defaclrole = 'postgres'::regrole
    and d.defaclnamespace in (0, 'public'::regnamespace::oid)
    and d.defaclobjtype in ('r', 'S', 'f')
    and (acl.grantee = 0 or acl.grantee in (
      select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')
    ));

  if v_implicit_api_grants <> 0 then
    raise exception 'Fixture has implicit API grants in global/public defaults.';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where n.nspname = 'public' and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Fixture has public-schema functions executable by PUBLIC.';
  end if;

  foreach v_table in array array[
    'businesses',
    'products',
    'orders',
    'order_items',
    'business_order_counters',
    'public_order_rate_limit_buckets'
  ]
  loop
    select count(*)
    into v_excess_grant_count
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
    cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as perms(priv_name)
    where has_table_privilege(roles.role_name, format('public.%I', v_table), perms.priv_name);

    if v_excess_grant_count <> 0 then
      raise exception 'Fixture ACL check failed: broad GRANT ALL privilege detected on public.%.', v_table;
    end if;
  end loop;
end
$verify_acl_contract$;

commit;

\echo WHATSAPP_PRICE_CONSISTENCY_FIXTURE_READY=1
