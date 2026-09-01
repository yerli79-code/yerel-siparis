begin;

create table public.public_order_rate_limit_buckets (
  dimension text not null,
  subject_key text not null,
  policy text not null,
  capacity integer not null,
  refill_window_seconds integer not null,
  tokens double precision not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null,
  constraint public_order_rate_limit_buckets_pkey
    primary key (dimension, subject_key, policy),
  constraint public_order_rate_limit_buckets_dimension_check
    check (dimension in ('ip', 'business')),
  constraint public_order_rate_limit_buckets_subject_key_check
    check (char_length(subject_key) between 1 and 140),
  constraint public_order_rate_limit_buckets_policy_check
    check (policy in ('burst', 'sustained')),
  constraint public_order_rate_limit_buckets_capacity_check
    check (capacity > 0),
  constraint public_order_rate_limit_buckets_window_check
    check (refill_window_seconds > 0),
  constraint public_order_rate_limit_buckets_tokens_check
    check (tokens >= 0)
);

create index public_order_rate_limit_buckets_expiry_idx
  on public.public_order_rate_limit_buckets (expires_at);

alter table public.public_order_rate_limit_buckets enable row level security;

revoke all on table public.public_order_rate_limit_buckets from public;
revoke all on table public.public_order_rate_limit_buckets from anon;
revoke all on table public.public_order_rate_limit_buckets from authenticated;
revoke all on table public.public_order_rate_limit_buckets from service_role;
grant select, insert, update, delete
  on table public.public_order_rate_limit_buckets
  to service_role;

create or replace function public.check_public_order_rate_limit(
  p_ip_fingerprint text,
  p_business_slug text
)
returns table (
  allowed boolean,
  blocked_dimension text,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_first_lock bigint;
  v_second_lock bigint;
  v_allowed boolean;
  v_blocked_dimension text;
  v_retry_after_seconds integer;
begin
  if p_ip_fingerprint is null
    or p_ip_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_ip_fingerprint';
  end if;

  if p_business_slug is null
    or char_length(p_business_slug) < 1
    or char_length(p_business_slug) > 140 then
    raise exception 'invalid_business_slug';
  end if;

  -- Serialize every subject in a stable global order so concurrent serverless
  -- invocations cannot overspend a bucket or deadlock across dimensions.
  v_first_lock := hashtextextended(
    'public-order-rate-limit:ip:' || p_ip_fingerprint,
    0
  );
  v_second_lock := hashtextextended(
    'public-order-rate-limit:business:' || p_business_slug,
    0
  );

  if v_first_lock <= v_second_lock then
    perform pg_catalog.pg_advisory_xact_lock(v_first_lock);
    if v_second_lock <> v_first_lock then
      perform pg_catalog.pg_advisory_xact_lock(v_second_lock);
    end if;
  else
    perform pg_catalog.pg_advisory_xact_lock(v_second_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_first_lock);
  end if;

  -- Cleanup is deliberately bounded so an order attempt cannot trigger an
  -- unbounded maintenance query. Idle buckets live for at most 30 minutes.
  delete from public.public_order_rate_limit_buckets as bucket
  where bucket.ctid in (
    select expired.ctid
    from public.public_order_rate_limit_buckets as expired
    where expired.expires_at <= v_now
    order by expired.expires_at
    limit 100
  );

  insert into public.public_order_rate_limit_buckets (
    dimension,
    subject_key,
    policy,
    capacity,
    refill_window_seconds,
    tokens,
    updated_at,
    expires_at
  )
  values
    ('ip', p_ip_fingerprint, 'burst', 5, 60, 5, v_now, v_now + interval '30 minutes'),
    ('ip', p_ip_fingerprint, 'sustained', 20, 900, 20, v_now, v_now + interval '30 minutes'),
    ('business', p_business_slug, 'burst', 20, 60, 20, v_now, v_now + interval '30 minutes'),
    ('business', p_business_slug, 'sustained', 100, 900, 100, v_now, v_now + interval '30 minutes')
  on conflict (dimension, subject_key, policy) do nothing;

  with policy_state as (
    select
      bucket.dimension,
      bucket.policy,
      least(
        bucket.capacity::double precision,
        bucket.tokens
          + greatest(
              0::double precision,
              extract(epoch from (v_now - bucket.updated_at))::double precision
            )
            * bucket.capacity::double precision
            / bucket.refill_window_seconds::double precision
      ) as available_tokens,
      bucket.capacity,
      bucket.refill_window_seconds
    from public.public_order_rate_limit_buckets as bucket
    where (bucket.dimension = 'ip' and bucket.subject_key = p_ip_fingerprint)
       or (bucket.dimension = 'business' and bucket.subject_key = p_business_slug)
  )
  select
    bool_and(state.available_tokens >= 1),
    (
      array_agg(
        state.dimension
        order by case state.dimension when 'ip' then 0 else 1 end
      ) filter (where state.available_tokens < 1)
    )[1],
    coalesce(
      max(
        greatest(
          1,
          ceil(
            (1 - state.available_tokens)
            * state.refill_window_seconds::double precision
            / state.capacity::double precision
          )::integer
        )
      ) filter (where state.available_tokens < 1),
      0
    )
  into v_allowed, v_blocked_dimension, v_retry_after_seconds
  from policy_state as state;

  if v_allowed then
    update public.public_order_rate_limit_buckets as bucket
    set
      tokens = least(
        bucket.capacity::double precision,
        bucket.tokens
          + greatest(
              0::double precision,
              extract(epoch from (v_now - bucket.updated_at))::double precision
            )
            * bucket.capacity::double precision
            / bucket.refill_window_seconds::double precision
      ) - 1,
      updated_at = v_now,
      expires_at = v_now + interval '30 minutes'
    where (bucket.dimension = 'ip' and bucket.subject_key = p_ip_fingerprint)
       or (bucket.dimension = 'business' and bucket.subject_key = p_business_slug);
  end if;

  return query
  select v_allowed, v_blocked_dimension, v_retry_after_seconds;
end;
$$;

revoke all on function public.check_public_order_rate_limit(text, text) from public;
revoke all on function public.check_public_order_rate_limit(text, text) from anon;
revoke all on function public.check_public_order_rate_limit(text, text) from authenticated;
grant execute on function public.check_public_order_rate_limit(text, text)
  to service_role;

comment on table public.public_order_rate_limit_buckets is
  'Durable token buckets for public order abuse protection; contains no raw IP or customer PII.';
comment on function public.check_public_order_rate_limit(text, text) is
  'Atomically checks IP and business public-order token buckets for service_role callers.';

commit;
