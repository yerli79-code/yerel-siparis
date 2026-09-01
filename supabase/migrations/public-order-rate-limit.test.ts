import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("./20260901202413_public_order_rate_limit.sql", import.meta.url),
  "utf8",
);

test("durable rate limiter defines both burst and sustained IP/business buckets", () => {
  for (const policy of [
    "('ip', p_ip_fingerprint, 'burst', 5, 60",
    "('ip', p_ip_fingerprint, 'sustained', 20, 900",
    "('business', p_business_slug, 'burst', 20, 60",
    "('business', p_business_slug, 'sustained', 100, 900",
  ]) {
    assert.match(migration, new RegExp(policy.replace(/[()]/g, "\\$&")));
  }
  assert.match(migration, /primary key \(dimension, subject_key, policy\)/i);
  assert.match(migration, /on conflict \(dimension, subject_key, policy\) do nothing/i);
});

test("concurrent limiter calls serialize subjects and decrement atomically", () => {
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(migration, /order by case state\.dimension when 'ip' then 0 else 1 end/i);
  assert.match(migration, /tokens\s*=\s*least\([\s\S]*\)\s*-\s*1/i);
  assert.match(migration, /return query\s+select v_allowed, v_blocked_dimension, v_retry_after_seconds/i);
});

test("rate storage is RLS protected and service-role only", () => {
  assert.match(
    migration,
    /alter table public\.public_order_rate_limit_buckets enable row level security/i,
  );
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.check_public_order_rate_limit\\(text, text\\) from ${role}`,
        "i",
      ),
    );
  }
  assert.match(
    migration,
    /grant execute on function public\.check_public_order_rate_limit\(text, text\)[\s\S]*to service_role/i,
  );
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test("rate records contain no customer PII, idempotency key or raw IP column", () => {
  const tableDefinition = migration.slice(
    migration.indexOf("create table public.public_order_rate_limit_buckets"),
    migration.indexOf(");", migration.indexOf("create table public.public_order_rate_limit_buckets")),
  );
  assert.doesNotMatch(
    tableDefinition,
    /customer|phone|address|note|idempotency|raw_ip|ip_address/i,
  );
  assert.match(tableDefinition, /subject_key text not null/i);
});

test("expired bucket cleanup is bounded", () => {
  assert.match(migration, /where expired\.expires_at <= v_now/i);
  assert.match(migration, /order by expired\.expires_at\s+limit 100/i);
  assert.match(migration, /v_now \+ interval '30 minutes'/i);
});
