import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260811003255_add_print_job_foundation.sql",
);
const sql = readFileSync(migrationPath, "utf8");

test("migration creates all three print foundation tables", () => {
  for (const table of [
    "print_pairing_sessions",
    "print_devices",
    "print_jobs",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table} \\(`, "i"));
  }
});

test("pairing hashes are versioned and plaintext code columns do not exist", () => {
  assert.match(sql, /code_hash text not null/i);
  assert.match(sql, /\^v\[1-9\]/);
  assert.doesNotMatch(sql, /\b(pairing_code|plain(?:text)?_code)\b/i);
});

test("device MVP constraints lock paper, copies, mode, and cutting", () => {
  assert.match(sql, /paper_width_mm in \(58, 80\)/i);
  assert.match(sql, /copies = 1/i);
  assert.match(sql, /print_mode = 'system'/i);
  assert.match(sql, /cut_enabled is false/i);
});

test("jobs accept only the currently supported contract and profile version", () => {
  assert.match(sql, /print_profile_version = 1/i);
  assert.match(sql, /schema_version = 1/i);
});

test("only one active primary exists independently of auto print toggle", () => {
  const primaryIndex = sql.match(
    /create unique index print_devices_one_active_primary_per_business_idx[\s\S]*?revoked_at is null;/i,
  )?.[0];
  assert.ok(primaryIndex);
  assert.match(primaryIndex, /enabled is true/i);
  assert.match(primaryIndex, /is_primary is true/i);
  assert.doesNotMatch(primaryIndex, /auto_print_enabled/i);
});

test("auto job logical key is partial and excludes test/reprint jobs", () => {
  const logicalIndex = sql.match(
    /create unique index print_jobs_auto_logical_key_idx[\s\S]*?where job_type = 'auto';/i,
  )?.[0];
  assert.ok(logicalIndex);
  for (const column of [
    "business_id",
    "order_id",
    "job_type",
    "print_profile_version",
  ]) {
    assert.match(logicalIndex, new RegExp(`\\b${column}\\b`, "i"));
  }
});

test("claim preparation indexes match target and business query shapes", () => {
  assert.match(
    sql,
    /\(\s*target_device_id,\s*status,\s*available_at,\s*created_at\s*\)/i,
  );
  assert.match(
    sql,
    /\(business_id, status, created_at desc\)/i,
  );
  assert.match(sql, /print_jobs_order_id_idx[\s\S]*?\(order_id\)/i);
});

test("all new tables enable RLS and revoke browser roles", () => {
  for (const table of [
    "print_pairing_sessions",
    "print_devices",
    "print_jobs",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`, "i"),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all privileges on table public\\.${table}[\\s\\S]*?from public, anon, authenticated`,
        "i",
      ),
    );
  }
  assert.doesNotMatch(sql, /create policy/i);
});

test("service role receives explicit table access only", () => {
  for (const table of [
    "print_pairing_sessions",
    "print_devices",
    "print_jobs",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `grant select, insert, update, delete on table public\\.${table}[\\s\\S]*?to service_role`,
        "i",
      ),
    );
  }
});

test("auto outbox requires an enabled non-revoked primary with auto print", () => {
  const triggerFunction = sql.match(
    /create or replace function public\.enqueue_order_auto_print_job\(\)[\s\S]*?\$\$;/i,
  )?.[0];
  assert.ok(triggerFunction);
  assert.match(triggerFunction, /d\.enabled is true/i);
  assert.match(triggerFunction, /d\.is_primary is true/i);
  assert.match(triggerFunction, /d\.auto_print_enabled is true/i);
  assert.match(triggerFunction, /d\.revoked_at is null/i);
  assert.match(triggerFunction, /if v_target_device_id is null then\s+return new/i);
});

test("outbox snapshots the selected target and inserts a minimal payload", () => {
  assert.match(sql, /target_device_id,[\s\S]*?v_target_device_id,/i);
  assert.match(
    sql,
    /schema_version,[\s\S]*?payload,[\s\S]*?payload_hash,[\s\S]*?'auto',[\s\S]*?1,[\s\S]*?1,[\s\S]*?null,[\s\S]*?null,/i,
  );
});

test("payload and payload hash must be null or materialized together", () => {
  const constraint = sql.match(
    /constraint print_jobs_payload_hash_check check \([\s\S]*?\n  \),/i,
  )?.[0];
  assert.ok(constraint);
  assert.match(constraint, /payload is null and payload_hash is null/i);
  assert.match(constraint, /payload is not null/i);
  assert.match(constraint, /payload_hash is not null/i);
  assert.match(constraint, /\^\[0-9a-f\]\{64\}\$/i);
});

test("auto jobs receive a 24 hour expiry without a two-hour transition", () => {
  assert.match(sql, /v_created_at \+ interval '24 hours'/i);
  assert.doesNotMatch(sql, /interval '2 hours'/i);
});

test("outbox trigger is an atomic AFTER INSERT participant", () => {
  assert.match(
    sql,
    /create trigger enqueue_order_auto_print_job\s+after insert on public\.orders\s+for each row\s+execute function public\.enqueue_order_auto_print_job\(\)/i,
  );
  assert.doesNotMatch(sql, /exception\s+when|dblink|http|net\./i);
});

test("idempotent order retries cannot create another auto job", () => {
  assert.match(
    sql,
    /on conflict \(\s*business_id,\s*order_id,\s*job_type,\s*print_profile_version\s*\) where job_type = 'auto'\s+do nothing/i,
  );
});

test("composite foreign keys enforce business isolation", () => {
  assert.match(
    sql,
    /foreign key \(business_id, order_id\)\s+references public\.orders\(business_id, id\)/i,
  );
  assert.match(
    sql,
    /foreign key \(business_id, target_device_id\)\s+references public\.print_devices\(business_id, id\)/i,
  );
});

test("trigger functions use fixed search paths and expose no public execute", () => {
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /execute\s+format|dynamic sql/i);
  assert.equal(
    (sql.match(/set search_path = pg_catalog, public/g) ?? []).length,
    2,
  );
  assert.equal(
    (sql.match(/revoke all on function public\./g) ?? []).length,
    2,
  );
});
