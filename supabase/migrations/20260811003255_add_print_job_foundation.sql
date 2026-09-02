-- P3.3.1A print device/job foundation and atomic minimal auto-print outbox.
-- Receipt payloads remain NULL here and are materialized by a later claim phase.

begin;

create table public.print_pairing_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code_hash text not null,
  qr_secret_hash text null,
  created_by_user_id uuid null references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint print_pairing_sessions_code_hash_check check (
    char_length(code_hash) between 20 and 600
    and code_hash ~ '^v[1-9][0-9]*[$][a-z0-9][a-z0-9_-]{0,31}[$][!-~]{20,512}$'
  ),
  constraint print_pairing_sessions_qr_secret_hash_check check (
    qr_secret_hash is null
    or (
      char_length(qr_secret_hash) between 20 and 600
      and qr_secret_hash ~ '^v[1-9][0-9]*[$][a-z0-9][a-z0-9_-]{0,31}[$][!-~]{20,512}$'
    )
  ),
  constraint print_pairing_sessions_attempt_count_check check (
    attempt_count >= 0
  ),
  constraint print_pairing_sessions_expires_at_check check (
    expires_at > created_at
  ),
  constraint print_pairing_sessions_consumed_at_check check (
    consumed_at is null or consumed_at >= created_at
  )
);

create index print_pairing_sessions_business_expires_at_idx
  on public.print_pairing_sessions (business_id, expires_at)
  where consumed_at is null;

create table public.print_devices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  device_name text not null,
  credential_hash text null,
  credential_version integer null,
  enabled boolean not null default true,
  is_primary boolean not null default false,
  auto_print_enabled boolean not null default false,
  platform text null,
  agent_version text null,
  host_label text null,
  paper_width_mm integer not null default 80,
  copies integer not null default 1,
  print_mode text not null default 'system',
  cut_enabled boolean not null default false,
  last_seen_at timestamptz null,
  last_spool_success_at timestamptz null,
  printer_configured boolean not null default false,
  printer_status text null,
  last_error_code text null,
  queue_size integer not null default 0,
  credential_rotated_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_devices_business_id_id_unique unique (business_id, id),
  constraint print_devices_device_name_check check (
    nullif(btrim(device_name), '') is not null
    and char_length(device_name) <= 120
  ),
  constraint print_devices_credential_pair_check check (
    (credential_hash is null and credential_version is null)
    or (
      credential_hash is not null
      and credential_version is not null
      and credential_version > 0
      and char_length(credential_hash) between 20 and 600
      and credential_hash ~ '^[a-z0-9][a-z0-9_-]{0,31}[$][!-~]{20,512}$'
    )
  ),
  constraint print_devices_platform_check check (
    platform is null or char_length(platform) between 1 and 64
  ),
  constraint print_devices_agent_version_check check (
    agent_version is null or char_length(agent_version) between 1 and 64
  ),
  constraint print_devices_host_label_check check (
    host_label is null or char_length(host_label) between 1 and 120
  ),
  constraint print_devices_paper_width_mm_check check (
    paper_width_mm in (58, 80)
  ),
  constraint print_devices_copies_check check (copies = 1),
  constraint print_devices_print_mode_check check (print_mode = 'system'),
  constraint print_devices_cut_enabled_check check (cut_enabled is false),
  constraint print_devices_printer_status_check check (
    printer_status is null or char_length(printer_status) between 1 and 64
  ),
  constraint print_devices_last_error_code_check check (
    last_error_code is null or char_length(last_error_code) between 1 and 120
  ),
  constraint print_devices_queue_size_check check (queue_size >= 0),
  constraint print_devices_revoked_at_check check (
    revoked_at is null or revoked_at >= created_at
  ),
  constraint print_devices_updated_at_check check (updated_at >= created_at)
);

-- Primary selection and auto-print enablement are intentionally independent.
-- A business may have one active primary device with auto_print_enabled = false.
create unique index print_devices_one_active_primary_per_business_idx
  on public.print_devices (business_id)
  where enabled is true
    and is_primary is true
    and revoked_at is null;

-- Required by the print job's composite order/business foreign key.
create unique index orders_business_id_id_unique_idx
  on public.orders (business_id, id);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid null,
  target_device_id uuid null,
  job_type text not null,
  reprint_of_job_id uuid null,
  print_profile_version integer not null,
  schema_version integer not null,
  payload jsonb null,
  payload_hash text null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  expires_at timestamptz null,
  claimed_at timestamptz null,
  claim_expires_at timestamptz null,
  claimed_by_device_id uuid null,
  submitted_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_jobs_business_id_id_unique unique (business_id, id),
  constraint print_jobs_order_fk foreign key (business_id, order_id)
    references public.orders(business_id, id) on delete cascade,
  constraint print_jobs_target_device_fk foreign key (business_id, target_device_id)
    references public.print_devices(business_id, id),
  constraint print_jobs_claimed_by_device_fk foreign key (
    business_id,
    claimed_by_device_id
  ) references public.print_devices(business_id, id),
  constraint print_jobs_reprint_of_job_fk foreign key (
    business_id,
    reprint_of_job_id
  ) references public.print_jobs(business_id, id),
  constraint print_jobs_job_type_check check (
    job_type in ('auto', 'test', 'reprint')
  ),
  constraint print_jobs_reprint_reference_check check (
    (job_type = 'reprint') = (reprint_of_job_id is not null)
    and (reprint_of_job_id is null or reprint_of_job_id <> id)
  ),
  constraint print_jobs_auto_metadata_check check (
    job_type <> 'auto'
    or (
      order_id is not null
      and target_device_id is not null
      and expires_at is not null
    )
  ),
  constraint print_jobs_profile_version_check check (
    print_profile_version = 1
  ),
  constraint print_jobs_schema_version_check check (schema_version = 1),
  constraint print_jobs_payload_hash_check check (
    (payload is null and payload_hash is null)
    or (
      payload is not null
      and payload_hash is not null
      and payload_hash ~ '^[0-9a-f]{64}$'
    )
  ),
  constraint print_jobs_status_check check (
    status in (
      'pending',
      'claimed',
      'submitted',
      'failed',
      'uncertain',
      'cancelled'
    )
  ),
  constraint print_jobs_attempts_check check (attempts >= 0),
  constraint print_jobs_available_at_check check (available_at >= created_at),
  constraint print_jobs_expires_at_check check (
    expires_at is null or expires_at > created_at
  ),
  constraint print_jobs_claim_expiry_check check (
    claim_expires_at is null
    or (claimed_at is not null and claim_expires_at > claimed_at)
  ),
  constraint print_jobs_submitted_at_check check (
    submitted_at is null or submitted_at >= created_at
  ),
  constraint print_jobs_last_error_code_check check (
    last_error_code is null or char_length(last_error_code) between 1 and 120
  ),
  constraint print_jobs_updated_at_check check (updated_at >= created_at)
);

-- One logical automatic job per order and print profile. Test and reprint jobs
-- retain independent UUIDs and do not participate in this deduplication key.
create unique index print_jobs_auto_logical_key_idx
  on public.print_jobs (
    business_id,
    order_id,
    job_type,
    print_profile_version
  )
  where job_type = 'auto';

-- Supports a targeted claim scan: equality on target/status followed by the
-- available/created ordering range. Claim-phase freshness predicates can be
-- applied without changing the index shape.
create index print_jobs_target_status_available_created_idx
  on public.print_jobs (
    target_device_id,
    status,
    available_at,
    created_at
  );

create index print_jobs_business_status_created_idx
  on public.print_jobs (business_id, status, created_at desc);

create index print_jobs_order_id_idx
  on public.print_jobs (order_id);

create or replace function public.set_print_foundation_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_print_devices_updated_at
before update on public.print_devices
for each row
execute function public.set_print_foundation_updated_at();

create trigger set_print_jobs_updated_at
before update on public.print_jobs
for each row
execute function public.set_print_foundation_updated_at();

create or replace function public.enqueue_order_auto_print_job()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_target_device_id uuid;
  v_created_at timestamptz := now();
begin
  select d.id
  into v_target_device_id
  from public.print_devices d
  where d.business_id = new.business_id
    and d.enabled is true
    and d.is_primary is true
    and d.auto_print_enabled is true
    and d.revoked_at is null;

  if v_target_device_id is null then
    return new;
  end if;

  insert into public.print_jobs (
    business_id,
    order_id,
    target_device_id,
    job_type,
    print_profile_version,
    schema_version,
    payload,
    payload_hash,
    status,
    attempts,
    available_at,
    expires_at,
    created_at,
    updated_at
  )
  values (
    new.business_id,
    new.id,
    v_target_device_id,
    'auto',
    1,
    1,
    null,
    null,
    'pending',
    0,
    v_created_at,
    v_created_at + interval '24 hours',
    v_created_at,
    v_created_at
  )
  on conflict (
    business_id,
    order_id,
    job_type,
    print_profile_version
  ) where job_type = 'auto'
  do nothing;

  return new;
end;
$$;

create trigger enqueue_order_auto_print_job
after insert on public.orders
for each row
execute function public.enqueue_order_auto_print_job();

alter table public.print_pairing_sessions enable row level security;
alter table public.print_devices enable row level security;
alter table public.print_jobs enable row level security;

revoke all privileges on table public.print_pairing_sessions
  from public, anon, authenticated;
revoke all privileges on table public.print_devices
  from public, anon, authenticated;
revoke all privileges on table public.print_jobs
  from public, anon, authenticated;

grant select, insert, update, delete on table public.print_pairing_sessions
  to service_role;
grant select, insert, update, delete on table public.print_devices
  to service_role;
grant select, insert, update, delete on table public.print_jobs
  to service_role;

revoke all on function public.set_print_foundation_updated_at() from public;
revoke execute on function public.set_print_foundation_updated_at()
  from anon, authenticated;
grant execute on function public.set_print_foundation_updated_at()
  to service_role;

revoke all on function public.enqueue_order_auto_print_job() from public;
revoke execute on function public.enqueue_order_auto_print_job()
  from anon, authenticated;
grant execute on function public.enqueue_order_auto_print_job()
  to service_role;

commit;
