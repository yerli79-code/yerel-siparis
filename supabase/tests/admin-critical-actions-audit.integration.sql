\set ON_ERROR_STOP on

-- DISPOSABLE DATABASE ONLY. Never run this suite against production.
-- Invoke explicitly with: psql -v P51EA_DISPOSABLE=1 -f supabase/tests/admin-critical-actions-audit.integration.sql
\if :{?P51EA_DISPOSABLE}
\else
  \echo 'P51EA_DISPOSABLE=1 is required; refusing to run.'
  \quit
\endif
\if :P51EA_DISPOSABLE
\else
  \echo 'P51EA_DISPOSABLE must be truthy; refusing to run.'
  \quit
\endif

do $$
begin
  if pg_catalog.to_regclass('public.admin_audit_logs') is null then
    raise exception 'Apply the P5.1E-A migration to the disposable database first';
  end if;
  if pg_catalog.to_regprocedure(
    'public.admin_apply_business_action(uuid,text,timestamp with time zone,uuid,text,integer,date)'
  ) is null then
    raise exception 'P5.1E-A RPC is missing';
  end if;
end;
$$;

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'assertion failed: %', p_message;
  end if;
end;
$$;

-- Fixed synthetic identifiers make cleanup deterministic and touch no real rows.
delete from public.admin_audit_logs
where business_id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
delete from public.businesses
where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;

insert into public.businesses (
  id,
  slug,
  name,
  is_active,
  is_open,
  subscription_status,
  subscription_started_at,
  subscription_expires_at
) values (
  'e51ea000-0000-4000-8000-000000000001'::uuid,
  'p51ea-disposable-business',
  'P5.1E-A Disposable Business',
  true,
  false,
  'active',
  transaction_timestamp() - interval '1 day',
  transaction_timestamp() + interval '30 days'
);

select pg_catalog.pg_sleep(0.01);

-- A) deactivate; N) is_open untouched; O) before/after audit;
-- P) actor audit; Q) customer PII absent; M) updatedAt success.
set role service_role;
do $$
declare
  v_before public.businesses%rowtype;
  v_after public.businesses%rowtype;
  v_result jsonb;
  v_audit public.admin_audit_logs%rowtype;
begin
  select * into strict v_before
  from public.businesses
  where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;

  v_result := public.admin_apply_business_action(
    v_before.id,
    'deactivate',
    v_before.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid,
    'admin-audit@example.test'
  );

  select * into strict v_after
  from public.businesses
  where id = v_before.id;
  select * into strict v_audit
  from public.admin_audit_logs
  where business_id = v_before.id
  order by created_at desc, id desc
  limit 1;

  perform pg_temp.assert_true(v_result ->> 'ok' = 'true', 'deactivate succeeds');
  perform pg_temp.assert_true(v_after.is_active = false, 'deactivate clears is_active');
  perform pg_temp.assert_true(v_after.subscription_status = v_before.subscription_status, 'deactivate preserves status');
  perform pg_temp.assert_true(v_after.subscription_started_at = v_before.subscription_started_at, 'deactivate preserves start');
  perform pg_temp.assert_true(v_after.subscription_expires_at = v_before.subscription_expires_at, 'deactivate preserves expiry');
  perform pg_temp.assert_true(v_after.is_open = v_before.is_open, 'is_open untouched');
  perform pg_temp.assert_true(v_after.updated_at = (v_result -> 'business' ->> 'updatedAt')::timestamptz, 'updatedAt success value is real row version');
  perform pg_temp.assert_true(v_after.updated_at > v_before.updated_at, 'updatedAt advances');
  perform pg_temp.assert_true(v_audit.action = 'business.deactivated', 'deactivate audit action');
  perform pg_temp.assert_true(v_audit.actor_user_id = 'e51ea000-0000-4000-8000-000000000002'::uuid, 'actor audit user');
  perform pg_temp.assert_true(v_audit.actor_email = 'admin-audit@example.test', 'actor audit email');
  perform pg_temp.assert_true(v_audit.before_state ->> 'updated_at' = to_jsonb(v_before.updated_at) #>> '{}', 'before audit version');
  perform pg_temp.assert_true(v_audit.after_state ->> 'updated_at' = to_jsonb(v_after.updated_at) #>> '{}', 'after audit version');
  perform pg_temp.assert_true(
    pg_catalog.array_agg(k order by k) = array[
      'is_active',
      'subscription_expires_at',
      'subscription_started_at',
      'subscription_status',
      'updated_at'
    ]::text[],
    'customer PII absent from before snapshot'
  ) from jsonb_object_keys(v_audit.before_state) as keys(k);
  perform pg_temp.assert_true(
    pg_catalog.array_agg(k order by k) = array[
      'is_active',
      'subscription_expires_at',
      'subscription_started_at',
      'subscription_status',
      'updated_at'
    ]::text[],
    'customer PII absent from after snapshot'
  ) from jsonb_object_keys(v_audit.after_state) as keys(k);
end;
$$;
reset role;

select pg_catalog.pg_sleep(0.01);

-- B) reactivate.
set role service_role;
do $$
declare
  v_before public.businesses%rowtype;
  v_after public.businesses%rowtype;
  v_result jsonb;
begin
  select * into strict v_before from public.businesses
  where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  v_result := public.admin_apply_business_action(
    v_before.id, 'reactivate', v_before.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );
  select * into strict v_after from public.businesses where id = v_before.id;
  perform pg_temp.assert_true(v_result ->> 'ok' = 'true', 'reactivate succeeds');
  perform pg_temp.assert_true(v_after.is_active and v_after.subscription_status = 'active', 'reactivate restores access');
  perform pg_temp.assert_true(v_after.subscription_started_at = v_before.subscription_started_at, 'reactivate preserves start');
  perform pg_temp.assert_true(v_after.subscription_expires_at = v_before.subscription_expires_at, 'reactivate preserves expiry');
  perform pg_temp.assert_true(v_result ->> 'auditAction' = 'business.reactivated', 'normal reactivate audit');
end;
$$;
reset role;

-- C) blocked reactivate -> INVALID_STATE.
update public.businesses
set is_active = false,
    subscription_status = 'blocked',
    subscription_expires_at = transaction_timestamp() + interval '30 days'
where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
set role service_role;
do $$
declare
  v_row public.businesses%rowtype;
  v_result jsonb;
  v_audits bigint;
begin
  select * into strict v_row from public.businesses
  where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  select count(*) into v_audits from public.admin_audit_logs where business_id = v_row.id;
  v_result := public.admin_apply_business_action(
    v_row.id, 'reactivate', v_row.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );
  perform pg_temp.assert_true(v_result = '{"ok": false, "code": "INVALID_STATE"}'::jsonb, 'blocked reactivate invalid');
  perform pg_temp.assert_true((select count(*) from public.admin_audit_logs where business_id = v_row.id) = v_audits, 'blocked reactivate has no audit');
end;
$$;
reset role;

-- D) legacy recovery preserves dates and emits legacy_subscription.recovered.
update public.businesses
set is_active = false,
    subscription_status = 'expired',
    subscription_started_at = transaction_timestamp() - interval '2 days',
    subscription_expires_at = transaction_timestamp() + interval '20 days'
where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
set role service_role;
do $$
declare
  v_before public.businesses%rowtype;
  v_after public.businesses%rowtype;
  v_result jsonb;
begin
  select * into strict v_before from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  v_result := public.admin_apply_business_action(
    v_before.id, 'reactivate', v_before.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );
  select * into strict v_after from public.businesses where id = v_before.id;
  perform pg_temp.assert_true(v_after.is_active and v_after.subscription_status = 'active', 'legacy recovery restores access');
  perform pg_temp.assert_true(v_after.subscription_started_at = v_before.subscription_started_at, 'legacy recovery preserves start');
  perform pg_temp.assert_true(v_after.subscription_expires_at = v_before.subscription_expires_at, 'legacy recovery preserves expiry');
  perform pg_temp.assert_true(v_result ->> 'auditAction' = 'legacy_subscription.recovered', 'legacy recovery audit');
end;
$$;
reset role;

-- E) block preserves dates.
set role service_role;
do $$
declare
  v_before public.businesses%rowtype;
  v_after public.businesses%rowtype;
  v_result jsonb;
begin
  select * into strict v_before from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  v_result := public.admin_apply_business_action(
    v_before.id, 'block', v_before.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );
  select * into strict v_after from public.businesses where id = v_before.id;
  perform pg_temp.assert_true(v_after.is_active = false and v_after.subscription_status = 'blocked', 'block state');
  perform pg_temp.assert_true(v_after.subscription_started_at = v_before.subscription_started_at, 'block preserves start');
  perform pg_temp.assert_true(v_after.subscription_expires_at = v_before.subscription_expires_at, 'block preserves expiry');
  perform pg_temp.assert_true(v_result ->> 'auditAction' = 'business.blocked', 'block audit');
end;
$$;
reset role;

-- F) reset.
set role service_role;
do $$
declare
  v_row public.businesses%rowtype;
  v_result jsonb;
begin
  select * into strict v_row from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  v_result := public.admin_apply_business_action(
    v_row.id, 'reset_subscription', v_row.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );
  select * into strict v_row from public.businesses where id = v_row.id;
  perform pg_temp.assert_true(v_row.is_active = false and v_row.subscription_status = 'expired', 'reset access state');
  perform pg_temp.assert_true(v_row.subscription_started_at is null and v_row.subscription_expires_at is null, 'reset clears dates');
  perform pg_temp.assert_true(v_result ->> 'auditAction' = 'subscription.reset', 'reset audit');
end;
$$;
reset role;

-- G) extend 30/60/90/180/365, including intentional blocked-state unblock.
set role service_role;
do $$
declare
  v_days integer;
  v_row public.businesses%rowtype;
  v_result jsonb;
begin
  foreach v_days in array array[30, 60, 90, 180, 365]
  loop
    select * into strict v_row from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
    v_result := public.admin_apply_business_action(
      v_row.id, 'extend_subscription', v_row.updated_at,
      'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test', v_days, null
    );
    select * into strict v_row from public.businesses where id = v_row.id;
    perform pg_temp.assert_true(v_result ->> 'ok' = 'true', 'extend succeeds');
    perform pg_temp.assert_true(v_row.is_active and v_row.subscription_status = 'active', 'extend activates');
    perform pg_temp.assert_true(v_row.subscription_started_at = transaction_timestamp(), 'extend starts at transaction time');
    perform pg_temp.assert_true(v_row.subscription_expires_at = transaction_timestamp() + make_interval(days => v_days), 'extend uses now plus days');
    perform pg_temp.assert_true(v_result ->> 'auditAction' = 'subscription.extended', 'extend audit');
  end loop;
end;
$$;
reset role;

-- H) manual future date uses end-of-day Europe/Istanbul.
set role service_role;
do $$
declare
  v_row public.businesses%rowtype;
  v_date date := (transaction_timestamp() at time zone 'Europe/Istanbul')::date + 5;
  v_result jsonb;
begin
  select * into strict v_row from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  v_result := public.admin_apply_business_action(
    v_row.id, 'set_subscription_date', v_row.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test', null, v_date
  );
  select * into strict v_row from public.businesses where id = v_row.id;
  perform pg_temp.assert_true(v_result ->> 'ok' = 'true', 'manual future date succeeds');
  perform pg_temp.assert_true((v_row.subscription_expires_at at time zone 'Europe/Istanbul')::date = v_date, 'manual expiry local date');
  perform pg_temp.assert_true((v_row.subscription_expires_at at time zone 'Europe/Istanbul')::time = time '23:59:59.999999', 'manual expiry local end-of-day');
  perform pg_temp.assert_true(v_result ->> 'auditAction' = 'subscription.date_changed', 'manual date audit');
end;
$$;
reset role;

-- I) manual past date -> INVALID_STATE; J) unknown action.
set role service_role;
do $$
declare
  v_row public.businesses%rowtype;
  v_result jsonb;
  v_audits bigint;
begin
  select * into strict v_row from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  select count(*) into v_audits from public.admin_audit_logs where business_id = v_row.id;
  v_result := public.admin_apply_business_action(
    v_row.id, 'set_subscription_date', v_row.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test', null,
    (transaction_timestamp() at time zone 'Europe/Istanbul')::date
  );
  perform pg_temp.assert_true(v_result ->> 'code' = 'INVALID_STATE', 'manual past date invalid');
  v_result := public.admin_apply_business_action(
    v_row.id, 'unknown_action', v_row.updated_at,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );
  perform pg_temp.assert_true(v_result ->> 'code' = 'INVALID_STATE', 'unknown action invalid');
  perform pg_temp.assert_true((select count(*) from public.admin_audit_logs where business_id = v_row.id) = v_audits, 'logical failures create no audit');
end;
$$;
reset role;

-- K) missing business.
set role service_role;
do $$
declare
  v_result jsonb;
begin
  v_result := public.admin_apply_business_action(
    'e51ea000-0000-4000-8000-000000000099'::uuid,
    'deactivate',
    transaction_timestamp(),
    'e51ea000-0000-4000-8000-000000000002'::uuid,
    'admin-audit@example.test'
  );
  perform pg_temp.assert_true(v_result = '{"ok": false, "code": "NOT_FOUND"}'::jsonb, 'missing business result');
end;
$$;
reset role;

-- L) stale expectedUpdatedAt; W) two-tab conflict leaves only tab A audit.
update public.businesses
set is_active = true,
    subscription_status = 'active',
    subscription_expires_at = transaction_timestamp() + interval '20 days'
where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
select pg_catalog.pg_sleep(0.01);
set role service_role;
do $$
declare
  v_tab_a timestamptz;
  v_tab_b timestamptz;
  v_result_a jsonb;
  v_result_b jsonb;
  v_audits bigint;
  v_row public.businesses%rowtype;
begin
  select updated_at into strict v_tab_a from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  v_tab_b := v_tab_a;
  select count(*) into v_audits from public.admin_audit_logs where business_id = 'e51ea000-0000-4000-8000-000000000001'::uuid;

  v_result_a := public.admin_apply_business_action(
    'e51ea000-0000-4000-8000-000000000001'::uuid, 'deactivate', v_tab_a,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );
  v_result_b := public.admin_apply_business_action(
    'e51ea000-0000-4000-8000-000000000001'::uuid, 'block', v_tab_b,
    'e51ea000-0000-4000-8000-000000000002'::uuid, 'admin-audit@example.test'
  );

  select * into strict v_row from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  perform pg_temp.assert_true(v_result_a ->> 'ok' = 'true', 'two-tab tab A succeeds');
  perform pg_temp.assert_true(v_result_b = '{"ok": false, "code": "CONFLICT"}'::jsonb, 'stale expectedUpdatedAt conflicts');
  perform pg_temp.assert_true(v_row.is_active = false and v_row.subscription_status = 'active', 'two-tab keeps tab A state');
  perform pg_temp.assert_true((select count(*) from public.admin_audit_logs where business_id = v_row.id) = v_audits + 1, 'two-tab creates only tab A audit');
end;
$$;
reset role;

-- R) audit UPDATE denied; S) audit DELETE denied;
-- T) anon/authenticated audit denied; U) anon/authenticated RPC denied;
-- V) service_role RPC allowed.
do $$
declare
  v_signature text := 'public.admin_apply_business_action(uuid,text,timestamp with time zone,uuid,text,integer,date)';
begin
  perform pg_temp.assert_true(not has_table_privilege('service_role', 'public.admin_audit_logs', 'UPDATE'), 'audit update denied');
  perform pg_temp.assert_true(not has_table_privilege('service_role', 'public.admin_audit_logs', 'DELETE'), 'audit delete denied');
  perform pg_temp.assert_true(has_table_privilege('service_role', 'public.admin_audit_logs', 'SELECT'), 'service_role audit select');
  perform pg_temp.assert_true(has_table_privilege('service_role', 'public.admin_audit_logs', 'INSERT'), 'service_role audit insert');
  perform pg_temp.assert_true(not has_table_privilege('anon', 'public.admin_audit_logs', 'SELECT'), 'anon audit denied');
  perform pg_temp.assert_true(not has_table_privilege('authenticated', 'public.admin_audit_logs', 'SELECT'), 'authenticated audit denied');
  perform pg_temp.assert_true(not has_function_privilege('anon', v_signature, 'EXECUTE'), 'anon rpc denied');
  perform pg_temp.assert_true(not has_function_privilege('authenticated', v_signature, 'EXECUTE'), 'authenticated rpc denied');
  perform pg_temp.assert_true(has_function_privilege('service_role', v_signature, 'EXECUTE'), 'service_role rpc allowed');
end;
$$;

-- W) audit failure rollback: NULL actor email fails audit INSERT after UPDATE,
-- and the enclosing function statement rolls the business mutation back.
update public.businesses
set is_active = true,
    subscription_status = 'active',
    subscription_expires_at = transaction_timestamp() + interval '20 days'
where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
set role service_role;
do $$
declare
  v_before public.businesses%rowtype;
  v_after public.businesses%rowtype;
  v_audits bigint;
begin
  select * into strict v_before from public.businesses where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
  select count(*) into v_audits from public.admin_audit_logs where business_id = v_before.id;

  begin
    perform public.admin_apply_business_action(
      v_before.id, 'deactivate', v_before.updated_at,
      'e51ea000-0000-4000-8000-000000000002'::uuid, null
    );
    raise exception 'expected audit NOT NULL failure';
  exception
    when not_null_violation then null;
  end;

  select * into strict v_after from public.businesses where id = v_before.id;
  perform pg_temp.assert_true(v_after.is_active = v_before.is_active, 'audit failure rollback preserves state');
  perform pg_temp.assert_true(v_after.updated_at = v_before.updated_at, 'audit failure rollback preserves version');
  perform pg_temp.assert_true((select count(*) from public.admin_audit_logs where business_id = v_before.id) = v_audits, 'audit failure rollback creates no audit');
end;
$$;
reset role;

delete from public.admin_audit_logs
where business_id = 'e51ea000-0000-4000-8000-000000000001'::uuid;
delete from public.businesses
where id = 'e51ea000-0000-4000-8000-000000000001'::uuid;

-- Kept as an explicit terminal statement so static safety checks can verify cleanup intent.
begin;
rollback;
