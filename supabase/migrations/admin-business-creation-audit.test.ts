import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const directory = resolve(process.cwd(), "supabase/migrations");
const filenames = readdirSync(directory).filter((name) =>
  /^\d{14}_admin_business_creation_audit\.sql$/.test(name),
);
const sql = readFileSync(resolve(directory, filenames[0] ?? "missing.sql"), "utf8")
  .toLowerCase().replace(/\s+/g, " ");
const functionSql = sql.slice(
  sql.indexOf("create function public.admin_create_business_with_audit("),
  sql.indexOf("$$;", sql.indexOf("create function public.admin_create_business_with_audit(")) + 3,
);

test("one forward migration extends the exact audit action allowlist", () => {
  assert.equal(filenames.length, 1);
  assert.match(sql, /drop constraint admin_audit_logs_action_check/);
  const check = sql.slice(sql.indexOf("add constraint admin_audit_logs_action_check"),
    sql.indexOf("create function public.admin_create_business_with_audit"));
  assert.deepEqual(check.match(/'(?:business|subscription|legacy_subscription)\.[^']+'/g), [
    "'business.deactivated'", "'business.reactivated'", "'business.blocked'",
    "'subscription.extended'", "'subscription.date_changed'", "'subscription.reset'",
    "'legacy_subscription.recovered'", "'business.created'",
  ]);
  assert.match(check, /action in \(/);
  assert.doesNotMatch(check, /invalid\.action/);
});

test("RPC is typed, invoker-only, and performs both inserts without swallowing errors", () => {
  assert.match(functionSql, /p_business_id uuid/);
  assert.match(functionSql, /p_owner_id uuid/);
  assert.match(functionSql, /p_actor_user_id uuid/);
  assert.match(functionSql, /security invoker set search_path = ''/);
  assert.match(functionSql, /insert into public\.businesses[\s\S]*returning \* into v_business/);
  assert.match(functionSql, /insert into public\.admin_audit_logs/);
  assert.ok(functionSql.indexOf("insert into public.businesses") <
    functionSql.indexOf("insert into public.admin_audit_logs"));
  assert.doesNotMatch(functionSql, /exception when|security definer/);
  assert.match(functionSql, /'business\.created', '\{\}'::jsonb/);
  for (const field of ["is_active", "subscription_status", "subscription_started_at",
    "subscription_expires_at", "updated_at"]) {
    assert.match(functionSql, new RegExp(`'${field}', v_business\\.${field}`));
  }
  assert.doesNotMatch(functionSql.slice(functionSql.indexOf("insert into public.admin_audit_logs"),
    functionSql.indexOf("return jsonb_build_object")), /password|owner_email|address|customer/);
});

test("only service_role can execute the new RPC", () => {
  const grants = sql.slice(sql.indexOf("comment on function public.admin_create_business_with_audit"));
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(grants, new RegExp(`\\) from ${role};`));
  }
  assert.match(grants, /\) to service_role;/);
  assert.doesNotMatch(grants, /\) to (?:anon|authenticated|public);/);
  assert.doesNotMatch(sql, /grant (?:select|insert|update) on table/);
});
