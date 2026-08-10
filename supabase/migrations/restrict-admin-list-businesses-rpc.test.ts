import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const migrationFileNames = readdirSync(migrationsDirectory).filter((name) =>
  /^\d{14}_restrict_admin_list_businesses_rpc\.sql$/.test(name),
);
const migrationFileName = migrationFileNames[0] ?? "missing-migration.sql";
const migrationSql = readFileSync(
  resolve(migrationsDirectory, migrationFileName),
  "utf8",
);
const normalizedSql = migrationSql.toLowerCase().replace(/\s+/g, " ").trim();
const statements = migrationSql
  .split(";")
  .map((statement) => statement.toLowerCase().replace(/\s+/g, " ").trim())
  .filter(Boolean);
const permissionStatements = statements.slice(1, -1);

test("has exactly one timestamped admin_list_businesses permission migration", () => {
  assert.deepEqual(migrationFileNames, [
    "20260810232536_restrict_admin_list_businesses_rpc.sql",
  ]);
});

test("changes only the target function permissions inside one transaction", () => {
  assert.deepEqual(statements, [
    "begin",
    "revoke execute on function public.admin_list_businesses() from public",
    "revoke execute on function public.admin_list_businesses() from anon",
    "revoke execute on function public.admin_list_businesses() from authenticated",
    "grant execute on function public.admin_list_businesses() to service_role",
    "commit",
  ]);
});

test("revokes the PostgreSQL PUBLIC execute privilege", () => {
  assert.match(
    normalizedSql,
    /revoke execute on function public\.admin_list_businesses\(\) from public;/,
  );
});

test("revokes anon execute privilege", () => {
  assert.match(
    normalizedSql,
    /revoke execute on function public\.admin_list_businesses\(\) from anon;/,
  );
});

test("revokes authenticated execute privilege", () => {
  assert.match(
    normalizedSql,
    /revoke execute on function public\.admin_list_businesses\(\) from authenticated;/,
  );
});

test("preserves service_role through an explicit execute grant", () => {
  assert.match(
    normalizedSql,
    /grant execute on function public\.admin_list_businesses\(\) to service_role;/,
  );
});

test("uses the exact argument-free function signature for every ACL change", () => {
  assert.equal(permissionStatements.length, 4);
  for (const statement of permissionStatements) {
    assert.match(
      statement,
      /on function public\.admin_list_businesses\(\) (?:from|to) /,
    );
  }
});

test("does not drop the function", () => {
  assert.doesNotMatch(normalizedSql, /\bdrop\s+function\b/);
});

test("does not create, replace, or alter the function body", () => {
  assert.doesNotMatch(normalizedSql, /\bcreate(?:\s+or\s+replace)?\s+function\b/);
  assert.doesNotMatch(normalizedSql, /\balter\s+function\b/);
});

test("does not change tables or schemas", () => {
  assert.doesNotMatch(
    normalizedSql,
    /\b(?:create|alter|drop)\s+(?:table|schema)\b/,
  );
});

test("does not change RLS or policies", () => {
  assert.doesNotMatch(normalizedSql, /\brow\s+level\s+security\b/);
  assert.doesNotMatch(normalizedSql, /\b(?:create|alter|drop)\s+policy\b/);
});

test("does not couple the browser admin UI to the restricted RPC", () => {
  const adminPageSource = readFileSync(resolve("app/admin/page.tsx"), "utf8");
  assert.doesNotMatch(adminPageSource, /admin_list_businesses/i);
  assert.doesNotMatch(normalizedSql, /\b(?:sessionstorage|localstorage)\b/);
});

test("contains no P3.3 print-job SQL", () => {
  assert.doesNotMatch(
    normalizedSql,
    /\b(?:print_jobs?|print_job_items?|business_print_settings)\b/,
  );
});

test("contains no P4 reports SQL", () => {
  assert.doesNotMatch(
    normalizedSql,
    /\b(?:business_reports?|reporting|report_metrics?)\b/,
  );
});
