import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migrationFileNames = readdirSync(migrationsDirectory).filter((name) =>
  /^\d{14}_add_transactional_admin_audit_foundation\.sql$/.test(name),
);
const migrationFileName = migrationFileNames[0] ?? "missing-migration.sql";
const migrationSql = readFileSync(
  resolve(migrationsDirectory, migrationFileName),
  "utf8",
);
const normalizedSql = migrationSql.toLowerCase().replace(/\s+/g, " ").trim();
const functionStart = normalizedSql.indexOf(
  "create or replace function public.admin_apply_business_action(",
);
const functionEnd = normalizedSql.indexOf("$$;", functionStart);
const functionSql = normalizedSql.slice(functionStart, functionEnd + 3);
const snapshotBlock = (variable: "v_before_state" | "v_after_state") => {
  const start = functionSql.indexOf(`${variable} := jsonb_build_object(`);
  return functionSql.slice(start, functionSql.indexOf(");", start) + 2);
};
const beforeSnapshot = snapshotBlock("v_before_state");
const afterSnapshot = snapshotBlock("v_after_state");
const functionIdentity =
  "public.admin_apply_business_action( uuid, text, timestamptz, uuid, text, integer, date )";

test("has exactly one timestamped P5.1E-A migration source", () => {
  assert.deepEqual(migrationFileNames, [
    "20260817175419_add_transactional_admin_audit_foundation.sql",
  ]);
});

test("creates the additive audit table with the exact required fields", () => {
  for (const field of [
    "id uuid primary key default gen_random_uuid()",
    "business_id uuid not null",
    "actor_user_id uuid not null",
    "actor_email text not null",
    "action text not null",
    "before_state jsonb not null",
    "after_state jsonb not null",
    "created_at timestamptz not null default now()",
  ]) {
    assert.match(normalizedSql, new RegExp(field.replace(/[()]/g, "\\$&")));
  }
});

test("keeps business and actor identifiers as FK-free immutable snapshots", () => {
  assert.doesNotMatch(
    normalizedSql,
    /foreign key\s*\(\s*(?:business_id|actor_user_id)\s*\)|references\s+(?:public\.businesses|auth\.users)/,
  );
  assert.match(normalizedSql, /business identifier snapshot\. intentionally no fk/);
  assert.match(normalizedSql, /actor identifier snapshot\. intentionally no auth\.users fk/);
});

test("documents the legacy two-transaction hard-delete partial-loss reason", () => {
  assert.match(normalizedSql, /two-transaction hard-delete path/);
  assert.match(normalizedSql, /partial loss/);
});

test("constrains audit actions to the exact event allowlist", () => {
  const actionCheck = normalizedSql.slice(
    normalizedSql.indexOf("constraint admin_audit_logs_action_check"),
    normalizedSql.indexOf("constraint admin_audit_logs_before_state_object_check"),
  );
  assert.deepEqual(actionCheck.match(/'[^']+'/g), [
    "'business.deactivated'",
    "'business.reactivated'",
    "'business.blocked'",
    "'subscription.extended'",
    "'subscription.date_changed'",
    "'subscription.reset'",
    "'legacy_subscription.recovered'",
  ]);
});

test("requires before and after snapshots to be JSON objects", () => {
  assert.match(
    normalizedSql,
    /jsonb_typeof\(before_state\) = 'object'/,
  );
  assert.match(normalizedSql, /jsonb_typeof\(after_state\) = 'object'/);
});

test("adds only the business timeline index required by the MVP", () => {
  assert.match(
    normalizedSql,
    /create index admin_audit_logs_business_created_id_idx on public\.admin_audit_logs \(business_id, created_at desc, id desc\)/,
  );
  assert.equal((normalizedSql.match(/create (?:unique )?index/g) ?? []).length, 1);
});

test("enables RLS without browser policies", () => {
  assert.match(
    normalizedSql,
    /alter table public\.admin_audit_logs enable row level security/,
  );
  assert.doesNotMatch(normalizedSql, /create policy/);
});

test("revokes table access from PUBLIC, anon and authenticated", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(
      normalizedSql,
      new RegExp(`revoke all on table public\\.admin_audit_logs from ${role}`),
    );
  }
});

test("makes service_role audit access insert/select-only", () => {
  assert.match(
    normalizedSql,
    /revoke all on table public\.admin_audit_logs from service_role/,
  );
  assert.match(
    normalizedSql,
    /grant select, insert on table public\.admin_audit_logs to service_role/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /grant[^;]*(?:update|delete)[^;]*admin_audit_logs/,
  );
});

test("creates the expected RPC signature with no raw target-state inputs", () => {
  const signature = functionSql.slice(0, functionSql.indexOf(") returns jsonb") + 1);
  for (const parameter of [
    "p_business_id uuid",
    "p_action text",
    "p_expected_updated_at timestamptz",
    "p_actor_user_id uuid",
    "p_actor_email text",
    "p_extension_days integer default null",
    "p_expires_on date default null",
  ]) {
    assert.match(signature, new RegExp(parameter));
  }
  for (const forbidden of [
    "p_is_active",
    "p_subscription_status",
    "p_subscription_started_at",
    "p_subscription_expires_at",
  ]) {
    assert.doesNotMatch(signature, new RegExp(forbidden));
  }
});

test("uses SECURITY INVOKER with an empty search_path", () => {
  assert.match(functionSql, /language plpgsql security invoker set search_path = ''/);
  assert.doesNotMatch(functionSql, /security definer/);
});

test("schema-qualifies every application relation in the RPC", () => {
  assert.match(functionSql, /from public\.businesses/);
  assert.match(functionSql, /update public\.businesses/);
  assert.match(functionSql, /insert into public\.admin_audit_logs/);
  assert.doesNotMatch(functionSql, /(?:from|update|insert into) businesses\b/);
  assert.doesNotMatch(functionSql, /insert into admin_audit_logs\b/);
});

test("revokes RPC execution from browser roles and grants only service_role", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(
      normalizedSql,
      new RegExp(`revoke execute on function ${functionIdentity.replace(/[().]/g, "\\$&")} from ${role}`),
    );
  }
  assert.match(
    normalizedSql,
    new RegExp(`grant execute on function ${functionIdentity.replace(/[().]/g, "\\$&")} to service_role`),
  );
});

test("uses the exact internal action allowlist", () => {
  const allowlist = functionSql.slice(
    functionSql.indexOf("if p_action is null or p_action not in"),
    functionSql.indexOf("then", functionSql.indexOf("if p_action is null or p_action not in")),
  );
  assert.deepEqual(allowlist.match(/'[^']+'/g), [
    "'deactivate'",
    "'reactivate'",
    "'block'",
    "'reset_subscription'",
    "'extend_subscription'",
    "'set_subscription_date'",
  ]);
});

test("returns stable logical result codes rather than raising logical exceptions", () => {
  for (const code of ["NOT_FOUND", "CONFLICT", "INVALID_STATE"]) {
    assert.match(functionSql, new RegExp(`'code', '${code.toLowerCase()}'`, "i"));
  }
  assert.doesNotMatch(functionSql, /raise exception/);
  assert.match(functionSql, /'ok', true/);
  assert.match(functionSql, /'auditaction', v_audit_action/);
});

test("locks by immutable UUID before concurrency and state validation", () => {
  const lock = functionSql.indexOf(
    "from public.businesses where id = p_business_id for update",
  );
  const notFound = functionSql.indexOf("if not found", lock);
  const conflict = functionSql.indexOf(
    "v_business.updated_at is distinct from p_expected_updated_at",
    notFound,
  );
  const validation = functionSql.indexOf("p_action is null", conflict);
  const update = functionSql.indexOf("update public.businesses", validation);
  const audit = functionSql.indexOf("insert into public.admin_audit_logs", update);
  assert.ok(lock > -1 && lock < notFound);
  assert.ok(notFound < conflict && conflict < validation);
  assert.ok(validation < update && update < audit);
});

test("deactivate changes only is_active and emits business.deactivated", () => {
  const block = functionSql.slice(
    functionSql.indexOf("when 'deactivate'"),
    functionSql.indexOf("when 'reactivate'"),
  );
  assert.match(block, /if v_business\.is_active is not true/);
  assert.match(block, /set is_active = false/);
  assert.doesNotMatch(block, /subscription_status\s*=/);
  assert.match(block, /'business\.deactivated'/);
});

test("reactivate rejects blocked/elapsed state and supports legacy recovery", () => {
  const block = functionSql.slice(
    functionSql.indexOf("when 'reactivate'"),
    functionSql.indexOf("when 'block'"),
  );
  assert.match(block, /subscription_status = 'blocked'/);
  assert.match(block, /subscription_expires_at <= v_now/);
  assert.match(block, /set is_active = true, subscription_status = 'active'/);
  assert.match(block, /'business\.reactivated'/);
  assert.match(block, /'legacy_subscription\.recovered'/);
  assert.doesNotMatch(block, /subscription_started_at\s*=/);
  assert.doesNotMatch(block, /subscription_expires_at\s*=/);
});

test("block preserves dates and never changes is_open", () => {
  const block = functionSql.slice(
    functionSql.indexOf("when 'block'"),
    functionSql.indexOf("when 'reset_subscription'"),
  );
  assert.match(block, /is_active = false, subscription_status = 'blocked'/);
  assert.doesNotMatch(block, /subscription_(?:started|expires)_at\s*=/);
  assert.doesNotMatch(functionSql, /\bis_open\b/);
  assert.match(block, /'business\.blocked'/);
});

test("reset clears dates and expires access", () => {
  const block = functionSql.slice(
    functionSql.indexOf("when 'reset_subscription'"),
    functionSql.indexOf("when 'extend_subscription'"),
  );
  assert.match(block, /is_active = false/);
  assert.match(block, /subscription_status = 'expired'/);
  assert.match(block, /subscription_started_at = null/);
  assert.match(block, /subscription_expires_at = null/);
  assert.match(block, /'subscription\.reset'/);
});

test("extend accepts only product durations and starts from transaction time", () => {
  assert.match(functionSql, /p_extension_days not in \(30, 60, 90, 180, 365\)/);
  const block = functionSql.slice(
    functionSql.indexOf("when 'extend_subscription'"),
    functionSql.indexOf("when 'set_subscription_date'"),
  );
  assert.match(block, /v_new_expiry := v_now \+ make_interval\(days => p_extension_days\)/);
  assert.match(block, /subscription_started_at = v_now/);
  assert.match(block, /subscription_expires_at = v_new_expiry/);
  assert.match(block, /'subscription\.extended'/);
});

test("manual date rejects today/past and uses Istanbul end-of-day", () => {
  const block = functionSql.slice(functionSql.indexOf("when 'set_subscription_date'"));
  assert.match(block, /p_expires_on <= \(v_now at time zone 'europe\/istanbul'\)::date/);
  assert.match(block, /\(p_expires_on \+ 1\)::timestamp - interval '1 microsecond'/);
  assert.match(block, /at time zone 'europe\/istanbul'/);
  assert.match(block, /'subscription\.date_changed'/);
});

test("relies on the existing trigger and re-reads the actual updated_at", () => {
  assert.doesNotMatch(functionSql, /set\s+updated_at\s*=/);
  const lastUpdate = functionSql.lastIndexOf("update public.businesses");
  const reread = functionSql.indexOf("select * into strict v_business", lastUpdate);
  const audit = functionSql.indexOf("insert into public.admin_audit_logs", reread);
  assert.ok(lastUpdate < reread && reread < audit);
  assert.match(afterSnapshot, /'updated_at', v_business\.updated_at/);
});

test("before and after snapshots contain only critical state fields", () => {
  const expectedKeys = [
    "'is_active'",
    "'subscription_status'",
    "'subscription_started_at'",
    "'subscription_expires_at'",
    "'updated_at'",
  ];
  assert.deepEqual(beforeSnapshot.match(/'[a-z_]+'/g), expectedKeys);
  assert.deepEqual(afterSnapshot.match(/'[a-z_]+'/g), expectedKeys);
});

test("audit snapshots exclude customer and business profile PII", () => {
  for (const forbidden of [
    "name",
    "slug",
    "description",
    "whatsapp_order_number",
    "address",
    "logo_url",
    "cover_image_url",
    "customer_name",
    "customer_phone",
    "customer_address",
    "customer_note",
    "ip",
    "user_agent",
  ]) {
    assert.doesNotMatch(
      `${beforeSnapshot} ${afterSnapshot}`,
      new RegExp(`'${forbidden}'`),
    );
  }
});

test("documents trusted server-side actor provenance", () => {
  assert.match(normalizedSql, /actor parameters must come from the trusted application server requireadmin boundary/);
  assert.match(normalizedSql, /never from browser payloads/);
});

test("keeps business update and audit insert in one database function transaction", () => {
  assert.ok(functionSql.indexOf("update public.businesses") > -1);
  assert.ok(functionSql.indexOf("insert into public.admin_audit_logs") > -1);
  assert.equal((normalizedSql.match(/\bbegin;/g) ?? []).length, 1);
  assert.equal((normalizedSql.match(/\bcommit;/g) ?? []).length, 1);
});

test("preserves both legacy subscription RPC overloads", () => {
  assert.doesNotMatch(normalizedSql, /drop function[^;]*admin_update_business_subscription/);
});

test("adds no business delete guard or audit foreign key in this phase", () => {
  assert.doesNotMatch(normalizedSql, /before delete on public\.businesses/);
  assert.doesNotMatch(normalizedSql, /references public\.businesses/);
});

test("keeps the legacy hard-delete route and UI in this phase", () => {
  assert.equal(existsSync(resolve("app/api/admin/delete-business/route.ts")), true);
  const detailClient = readFileSync(
    resolve("app/admin/isletmeler/[id]/business-detail-client.tsx"),
    "utf8",
  );
  assert.match(detailClient, /Kalıcı Sil/);
  assert.match(detailClient, /deleteBusinessInSupabase/);
});

test("ships a disposable-only SQL integration suite for every required DB scenario", () => {
  const sqlTest = readFileSync(
    resolve("supabase/tests/admin-critical-actions-audit.integration.sql"),
    "utf8",
  );
  for (const marker of [
    "deactivate",
    "reactivate",
    "blocked reactivate",
    "legacy recovery",
    "block",
    "reset",
    "extend 30/60/90/180/365",
    "manual future date",
    "manual past date",
    "unknown action",
    "missing business",
    "stale expectedupdatedat",
    "updatedat success",
    "is_open untouched",
    "before/after audit",
    "actor audit",
    "customer pii absent",
    "audit update denied",
    "audit delete denied",
    "anon/authenticated audit denied",
    "anon/authenticated rpc denied",
    "service_role rpc allowed",
    "audit failure rollback",
    "two-tab conflict",
  ]) {
    assert.match(sqlTest.toLowerCase(), new RegExp(marker.replace("/", "\\/")));
  }
  assert.match(sqlTest.toLowerCase(), /^\\set on_error_stop on/m);
  assert.match(sqlTest.toLowerCase(), /rollback;/);
});

test("does not add retention, a global created_at index, or unrelated phase work", () => {
  assert.doesNotMatch(normalizedSql, /retention|cron|pg_cron/);
  assert.doesNotMatch(
    normalizedSql,
    /create (?:unique )?index[^;]*admin_audit_logs\s*\(created_at/,
  );
  assert.doesNotMatch(normalizedSql, /print_jobs?|business_reports?|report_metrics?/);
});
