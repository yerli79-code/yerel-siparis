begin;

alter table public.admin_audit_logs
  drop constraint admin_audit_logs_action_check;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check check (
    action in (
      'business.deactivated',
      'business.reactivated',
      'business.blocked',
      'subscription.extended',
      'subscription.date_changed',
      'subscription.reset',
      'legacy_subscription.recovered',
      'business.created'
    )
  );

create function public.admin_create_business_with_audit(
  p_business_id uuid,
  p_owner_id uuid,
  p_slug text,
  p_name text,
  p_description text,
  p_whatsapp_order_number text,
  p_city text,
  p_district text,
  p_neighborhood text,
  p_address text,
  p_subscription_status text,
  p_subscription_started_at timestamptz,
  p_subscription_expires_at timestamptz,
  p_is_active boolean,
  p_actor_user_id uuid,
  p_actor_email text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
begin
  if p_business_id is null or p_owner_id is null or p_actor_user_id is null
    or nullif(btrim(p_slug), '') is null
    or nullif(btrim(p_name), '') is null
    or nullif(btrim(p_whatsapp_order_number), '') is null
    or nullif(btrim(p_actor_email), '') is null
    or p_subscription_status is null
    or p_subscription_status not in ('active', 'expired', 'blocked')
    or p_is_active is null
  then
    raise exception 'Invalid business creation parameters' using errcode = '22023';
  end if;

  insert into public.businesses (
    id, owner_id, slug, name, description, whatsapp_order_number,
    city, district, neighborhood, address, subscription_status,
    subscription_started_at, subscription_expires_at, is_active
  ) values (
    p_business_id, p_owner_id, p_slug, p_name, p_description,
    p_whatsapp_order_number, p_city, p_district, p_neighborhood,
    p_address, p_subscription_status, p_subscription_started_at,
    p_subscription_expires_at, p_is_active
  ) returning * into v_business;

  insert into public.admin_audit_logs (
    business_id, actor_user_id, actor_email, action, before_state, after_state
  ) values (
    v_business.id, p_actor_user_id, p_actor_email, 'business.created', '{}'::jsonb,
    jsonb_build_object(
      'is_active', v_business.is_active,
      'subscription_status', v_business.subscription_status,
      'subscription_started_at', v_business.subscription_started_at,
      'subscription_expires_at', v_business.subscription_expires_at,
      'updated_at', v_business.updated_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'business', jsonb_build_object(
      'id', v_business.id,
      'owner_id', v_business.owner_id,
      'slug', v_business.slug,
      'name', v_business.name,
      'description', v_business.description,
      'whatsapp_order_number', v_business.whatsapp_order_number,
      'created_at', v_business.created_at,
      'category', v_business.category,
      'city', v_business.city,
      'district', v_business.district,
      'neighborhood', v_business.neighborhood,
      'address', v_business.address,
      'delivery_status', v_business.delivery_status,
      'logo_text', v_business.logo_text,
      'subscription_status', v_business.subscription_status,
      'subscription_started_at', v_business.subscription_started_at,
      'subscription_expires_at', v_business.subscription_expires_at,
      'is_active', v_business.is_active
    )
  );
end;
$$;

comment on function public.admin_create_business_with_audit(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, timestamptz, timestamptz, boolean, uuid, text
) is 'Service-role-only atomic business creation and audit. Actor inputs must originate from the verified Admin server session.';

revoke execute on function public.admin_create_business_with_audit(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, timestamptz, timestamptz, boolean, uuid, text
) from public;
revoke execute on function public.admin_create_business_with_audit(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, timestamptz, timestamptz, boolean, uuid, text
) from anon;
revoke execute on function public.admin_create_business_with_audit(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, timestamptz, timestamptz, boolean, uuid, text
) from authenticated;
grant execute on function public.admin_create_business_with_audit(
  uuid, uuid, text, text, text, text, text, text, text, text,
  text, timestamptz, timestamptz, boolean, uuid, text
) to service_role;

commit;
