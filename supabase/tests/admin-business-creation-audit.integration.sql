\set ON_ERROR_STOP on

-- DISPOSABLE DATABASE ONLY. Never run against production.
-- psql -v ADMIN_CREATION_DISPOSABLE=1 -f supabase/tests/admin-business-creation-audit.integration.sql
\if :{?ADMIN_CREATION_DISPOSABLE}
\else
  \echo 'ADMIN_CREATION_DISPOSABLE=1 is required; refusing to run.'
  \quit
\endif
\if :ADMIN_CREATION_DISPOSABLE
\else
  \echo 'ADMIN_CREATION_DISPOSABLE must be truthy; refusing to run.'
  \quit
\endif

begin;

do $$
begin
  if pg_catalog.to_regprocedure(
    'public.admin_create_business_with_audit(uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,boolean,uuid,text)'
  ) is null then
    raise exception 'Apply the new migration to a disposable database first';
  end if;
end;
$$;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'assertion failed: %', p_message; end if;
end;
$$;

-- Synthetic account and profile are rolled back with the entire test transaction.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at
) values (
  'a81d0000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'creation-audit-owner@example.test',
  '', now(), now(), now()
);
insert into public.profiles (id, email)
values ('a81d0000-0000-4000-8000-000000000001', 'creation-audit-owner@example.test')
on conflict (id) do nothing;

select pg_temp.assert_true(
  not has_function_privilege('anon',
    'public.admin_create_business_with_audit(uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,uuid,text)', 'EXECUTE'),
  'anon cannot execute');
select pg_temp.assert_true(
  not has_function_privilege('authenticated',
    'public.admin_create_business_with_audit(uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,uuid,text)', 'EXECUTE'),
  'authenticated cannot execute');
select pg_temp.assert_true(
  has_function_privilege('service_role',
    'public.admin_create_business_with_audit(uuid,uuid,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,uuid,text)', 'EXECUTE'),
  'service_role can execute');

set role service_role;
do $$
declare
  v_id uuid := 'a81d0000-0000-4000-8000-000000000002';
  v_owner uuid := 'a81d0000-0000-4000-8000-000000000001';
  v_actor uuid := 'a81d0000-0000-4000-8000-000000000003';
  v_result jsonb;
  v_business public.businesses%rowtype;
  v_audit public.admin_audit_logs%rowtype;
begin
  v_result := public.admin_create_business_with_audit(
    v_id, v_owner, 'creation-audit-disposable', 'Creation Audit Disposable',
    '', '5551234567', 'İstanbul', 'Kadıköy', 'Moda', '',
    'active', now(), now() + interval '30 days', true,
    v_actor, 'verified-admin@example.test'
  );
  select * into strict v_business from public.businesses where id = v_id;
  select * into strict v_audit from public.admin_audit_logs
    where business_id = v_id and action = 'business.created';
  perform pg_temp.assert_true(v_result->>'ok' = 'true', 'success result');
  perform pg_temp.assert_true(v_result->'business'->>'id' = v_id::text, 'returned id');
  perform pg_temp.assert_true(v_result->'business'->>'slug' = v_business.slug, 'returned persisted slug');
  perform pg_temp.assert_true(v_result->'business'->>'name' = v_business.name, 'returned persisted name');
  perform pg_temp.assert_true(v_audit.actor_user_id = v_actor, 'actor id');
  perform pg_temp.assert_true(v_audit.actor_email = 'verified-admin@example.test', 'actor email');
  perform pg_temp.assert_true(v_audit.before_state = '{}'::jsonb, 'empty before state');
  perform pg_temp.assert_true(v_audit.after_state = jsonb_build_object(
    'is_active', v_business.is_active,
    'subscription_status', v_business.subscription_status,
    'subscription_started_at', v_business.subscription_started_at,
    'subscription_expires_at', v_business.subscription_expires_at,
    'updated_at', v_business.updated_at
  ), 'after state from persisted row');
  perform pg_temp.assert_true((select count(*) from public.admin_audit_logs
    where business_id = v_id and action = 'business.created') = 1, 'one creation audit');

  begin
    perform public.admin_create_business_with_audit(
      'a81d0000-0000-4000-8000-000000000004', v_owner,
      'creation-audit-disposable', 'Duplicate', '', '5551234567',
      'İstanbul', 'Kadıköy', 'Moda', '', 'active', null, null, true,
      v_actor, 'verified-admin@example.test');
    raise exception 'duplicate slug unexpectedly succeeded';
  exception when unique_violation then null;
  end;
  perform pg_temp.assert_true(not exists (select 1 from public.businesses
    where id = 'a81d0000-0000-4000-8000-000000000004'), 'duplicate business absent');
  perform pg_temp.assert_true(not exists (select 1 from public.admin_audit_logs
    where business_id = 'a81d0000-0000-4000-8000-000000000004'), 'duplicate audit absent');

  begin
    insert into public.admin_audit_logs (
      business_id, actor_user_id, actor_email, action, before_state, after_state
    ) values (v_id, v_actor, 'verified-admin@example.test', 'invalid.action', '{}'::jsonb, '{}'::jsonb);
    raise exception 'invalid action unexpectedly succeeded';
  exception when check_violation then null;
  end;

  v_result := public.admin_apply_business_action(
    v_id, 'deactivate', v_business.updated_at, v_actor, 'verified-admin@example.test');
  perform pg_temp.assert_true(v_result->>'ok' = 'true', 'existing action still works');
end;
$$;
reset role;

-- A temporary trigger forces the audit insert to fail. The RPC must roll back its business insert.
create function pg_temp.fail_creation_audit() returns trigger language plpgsql as $$
begin
  if new.business_id = 'a81d0000-0000-4000-8000-000000000005'::uuid then
    raise exception 'forced audit failure';
  end if;
  return new;
end;
$$;
create trigger disposable_creation_audit_failure
before insert on public.admin_audit_logs
for each row execute function pg_temp.fail_creation_audit();

set role service_role;
do $$
begin
  begin
    perform public.admin_create_business_with_audit(
      'a81d0000-0000-4000-8000-000000000005',
      'a81d0000-0000-4000-8000-000000000001',
      'creation-audit-forced-failure', 'Forced Failure', '', '5551234567',
      'İstanbul', 'Kadıköy', 'Moda', '', 'active', null, null, true,
      'a81d0000-0000-4000-8000-000000000003', 'verified-admin@example.test');
    raise exception 'forced audit failure unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'forced audit failure' then raise; end if;
  end;
  perform pg_temp.assert_true(not exists (select 1 from public.businesses
    where id = 'a81d0000-0000-4000-8000-000000000005'), 'audit failure rolled back business');
end;
$$;
reset role;

rollback;
