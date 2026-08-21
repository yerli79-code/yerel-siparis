begin;

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  actor_user_id uuid not null,
  actor_email text not null,
  action text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  constraint admin_audit_logs_action_check check (
    action in (
      'business.deactivated',
      'business.reactivated',
      'business.blocked',
      'subscription.extended',
      'subscription.date_changed',
      'subscription.reset',
      'legacy_subscription.recovered'
    )
  ),
  constraint admin_audit_logs_before_state_object_check check (
    jsonb_typeof(before_state) = 'object'
  ),
  constraint admin_audit_logs_after_state_object_check check (
    jsonb_typeof(after_state) = 'object'
  )
);

comment on column public.admin_audit_logs.business_id is
  'Immutable business identifier snapshot. Intentionally no FK in this phase: the legacy two-transaction hard-delete path could otherwise delete products and then fail deleting the business, causing partial loss.';

comment on column public.admin_audit_logs.actor_user_id is
  'Immutable actor identifier snapshot. Intentionally no auth.users FK so audit history survives account deletion.';

create index admin_audit_logs_business_created_id_idx
  on public.admin_audit_logs (business_id, created_at desc, id desc);

alter table public.admin_audit_logs enable row level security;

revoke all on table public.admin_audit_logs from public;
revoke all on table public.admin_audit_logs from anon;
revoke all on table public.admin_audit_logs from authenticated;
revoke all on table public.admin_audit_logs from service_role;

grant select, insert on table public.admin_audit_logs to service_role;

create or replace function public.admin_apply_business_action(
  p_business_id uuid,
  p_action text,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_actor_email text,
  p_extension_days integer default null,
  p_expires_on date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
  v_now timestamptz := transaction_timestamp();
  v_audit_action text;
  v_before_state jsonb;
  v_after_state jsonb;
  v_new_expiry timestamptz;
begin
  select *
  into v_business
  from public.businesses
  where id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_business.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  if p_action is null or p_action not in (
    'deactivate',
    'reactivate',
    'block',
    'reset_subscription',
    'extend_subscription',
    'set_subscription_date'
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE');
  end if;

  if (
    p_action = 'extend_subscription'
    and (p_extension_days is null or p_extension_days not in (30, 60, 90, 180, 365) or p_expires_on is not null)
  ) or (
    p_action = 'set_subscription_date'
    and (p_expires_on is null or p_extension_days is not null)
  ) or (
    p_action not in ('extend_subscription', 'set_subscription_date')
    and (p_extension_days is not null or p_expires_on is not null)
  ) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATE');
  end if;

  v_before_state := jsonb_build_object(
    'is_active', v_business.is_active,
    'subscription_status', v_business.subscription_status,
    'subscription_started_at', v_business.subscription_started_at,
    'subscription_expires_at', v_business.subscription_expires_at,
    'updated_at', v_business.updated_at
  );

  case p_action
    when 'deactivate' then
      if v_business.is_active is not true then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STATE');
      end if;

      update public.businesses
      set is_active = false
      where id = p_business_id;

      v_audit_action := 'business.deactivated';

    when 'reactivate' then
      if v_business.is_active is true
        or v_business.subscription_status = 'blocked'
        or v_business.subscription_status not in ('active', 'expired')
        or v_business.subscription_expires_at is null
        or v_business.subscription_expires_at <= v_now then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STATE');
      end if;

      update public.businesses
      set
        is_active = true,
        subscription_status = 'active'
      where id = p_business_id;

      if v_business.subscription_status = 'expired' then
        v_audit_action := 'legacy_subscription.recovered';
      else
        v_audit_action := 'business.reactivated';
      end if;

    when 'block' then
      if v_business.subscription_status = 'blocked' then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STATE');
      end if;

      update public.businesses
      set
        is_active = false,
        subscription_status = 'blocked'
      where id = p_business_id;

      v_audit_action := 'business.blocked';

    when 'reset_subscription' then
      if v_business.is_active is false
        and v_business.subscription_status = 'expired'
        and v_business.subscription_started_at is null
        and v_business.subscription_expires_at is null then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STATE');
      end if;

      update public.businesses
      set
        is_active = false,
        subscription_status = 'expired',
        subscription_started_at = null,
        subscription_expires_at = null
      where id = p_business_id;

      v_audit_action := 'subscription.reset';

    when 'extend_subscription' then
      v_new_expiry := v_now + make_interval(days => p_extension_days);

      update public.businesses
      set
        is_active = true,
        subscription_status = 'active',
        subscription_started_at = v_now,
        subscription_expires_at = v_new_expiry
      where id = p_business_id;

      v_audit_action := 'subscription.extended';

    when 'set_subscription_date' then
      if p_expires_on <= (v_now at time zone 'Europe/Istanbul')::date then
        return jsonb_build_object('ok', false, 'code', 'INVALID_STATE');
      end if;

      v_new_expiry := (
        (p_expires_on + 1)::timestamp - interval '1 microsecond'
      ) at time zone 'Europe/Istanbul';

      update public.businesses
      set
        is_active = true,
        subscription_status = 'active',
        subscription_started_at = v_now,
        subscription_expires_at = v_new_expiry
      where id = p_business_id;

      v_audit_action := 'subscription.date_changed';
  end case;

  select *
  into strict v_business
  from public.businesses
  where id = p_business_id;

  v_after_state := jsonb_build_object(
    'is_active', v_business.is_active,
    'subscription_status', v_business.subscription_status,
    'subscription_started_at', v_business.subscription_started_at,
    'subscription_expires_at', v_business.subscription_expires_at,
    'updated_at', v_business.updated_at
  );

  insert into public.admin_audit_logs (
    business_id,
    actor_user_id,
    actor_email,
    action,
    before_state,
    after_state
  ) values (
    p_business_id,
    p_actor_user_id,
    p_actor_email,
    v_audit_action,
    v_before_state,
    v_after_state
  );

  return jsonb_build_object(
    'ok', true,
    'business', jsonb_build_object(
      'id', v_business.id,
      'isActive', v_business.is_active,
      'subscriptionStatus', v_business.subscription_status,
      'subscriptionStartedAt', v_business.subscription_started_at,
      'subscriptionExpiresAt', v_business.subscription_expires_at,
      'updatedAt', v_business.updated_at
    ),
    'auditAction', v_audit_action
  );
end;
$$;

comment on function public.admin_apply_business_action(
  uuid,
  text,
  timestamptz,
  uuid,
  text,
  integer,
  date
) is
  'Service-role-only transactional admin state machine. Actor parameters must come from the trusted application server requireAdmin boundary, never from browser payloads.';

revoke execute on function public.admin_apply_business_action(
  uuid,
  text,
  timestamptz,
  uuid,
  text,
  integer,
  date
) from public;

revoke execute on function public.admin_apply_business_action(
  uuid,
  text,
  timestamptz,
  uuid,
  text,
  integer,
  date
) from anon;

revoke execute on function public.admin_apply_business_action(
  uuid,
  text,
  timestamptz,
  uuid,
  text,
  integer,
  date
) from authenticated;

grant execute on function public.admin_apply_business_action(
  uuid,
  text,
  timestamptz,
  uuid,
  text,
  integer,
  date
) to service_role;

commit;
