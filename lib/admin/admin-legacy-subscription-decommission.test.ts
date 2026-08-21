import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

const detailClient = source("app/admin/isletmeler/[id]/business-detail-client.tsx");
const adminClient = source("lib/supabase-admin.ts");
const actionAdapter = source("lib/admin/business-actions.ts");
const safeBusinessRoute = source("app/api/admin/businesses/[id]/route.ts");
const safeBusinessAdapter = source("lib/admin/business-detail.ts");
const legacyBusinessRoute = source("app/api/admin/update-business/route.ts");

const criticalRoutePaths = [
  "app/api/admin/businesses/[id]/deactivate/route.ts",
  "app/api/admin/businesses/[id]/reactivate/route.ts",
  "app/api/admin/businesses/[id]/block/route.ts",
  "app/api/admin/businesses/[id]/reset-subscription/route.ts",
  "app/api/admin/businesses/[id]/subscription/route.ts",
] as const;
const criticalRoutes = criticalRoutePaths.map(source);

function productionTypeScriptSources(directory: "app" | "lib") {
  const base = new URL(`${directory}/`, root);
  const files: string[] = [];

  function visit(relative: string) {
    for (const entry of readdirSync(new URL(relative, base), { withFileTypes: true })) {
      const next = `${relative}${entry.name}`;
      if (entry.isDirectory()) {
        visit(`${next}/`);
      } else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        files.push(readFileSync(new URL(next, base), "utf8"));
      }
    }
  }

  visit("");
  return files.join("\n");
}

test("legacy subscription endpoint, helper, type and private validators are removed", () => {
  assert.equal(existsSync(new URL("app/api/admin/update-subscription/route.ts", root)), false);
  for (const marker of [
    "updateBusinessSubscriptionInSupabase",
    "SubscriptionUpdatePayload",
    "verifySubscriptionUpdate",
    "nullableDateKey",
  ]) {
    assert.doesNotMatch(adminClient, new RegExp(marker));
  }
});

test("production admin source contains no retired update-subscription URL", () => {
  const productionSource = `${productionTypeScriptSources("app")}\n${productionTypeScriptSources("lib")}`;
  assert.doesNotMatch(productionSource, /\/api\/admin\/update-subscription/);
});

test("admin detail UI keeps only audited critical API helpers", () => {
  for (const helper of [
    "deactivateAdminBusiness",
    "reactivateAdminBusiness",
    "blockAdminBusiness",
    "resetAdminBusinessSubscription",
    "extendAdminBusinessSubscription",
    "setAdminBusinessSubscriptionDate",
  ]) {
    assert.match(detailClient, new RegExp(helper));
  }
  assert.doesNotMatch(detailClient, /updateBusinessSubscriptionInSupabase/);
});

test("all five dedicated critical routes remain", () => {
  for (const path of criticalRoutePaths) {
    assert.equal(existsSync(new URL(path, root)), true);
  }
  assert.match(criticalRoutes[0], /export async function POST/);
  assert.match(criticalRoutes[1], /export async function POST/);
  assert.match(criticalRoutes[2], /export async function POST/);
  assert.match(criticalRoutes[3], /export async function POST/);
  assert.match(criticalRoutes[4], /export async function PATCH/);
});

test("critical server adapter remains server-only and RPC-only", () => {
  assert.match(actionAdapter, /^import "server-only";/);
  assert.match(actionAdapter, /\/rest\/v1\/rpc\/admin_apply_business_action/);
  assert.match(actionAdapter, /serviceFetch\(ADMIN_BUSINESS_ACTION_RPC_PATH/);
  assert.doesNotMatch(actionAdapter, /\/rest\/v1\/businesses\?/);
});

test("browser cannot choose actor or critical target database state", () => {
  const criticalClient = adminClient.slice(
    adminClient.indexOf("async function requestAdminBusinessCriticalMutation"),
    adminClient.indexOf("export async function fetchAdminBusinessDetail"),
  );
  assert.doesNotMatch(criticalClient, /actor|actorId|actorEmail/i);
  for (const field of [
    "is_active",
    "subscription_status",
    "subscription_started_at",
    "subscription_expires_at",
    "isActive",
    "subscriptionStatus",
    "subscriptionStartedAt",
    "subscriptionExpiresAt",
  ]) {
    assert.doesNotMatch(criticalClient, new RegExp(field));
  }
});

test("every RPC actor comes from requireAdmin and optimistic concurrency remains", () => {
  for (const route of criticalRoutes) {
    assert.match(route, /const actor = await requireAdmin\(\)/);
    assert.match(route, /actor,/);
    assert.match(route, /expectedUpdatedAt: payload\.expectedUpdatedAt/);
    assert.doesNotMatch(route, /body\.actor|payload\.actor|request.*actor/i);
  }
  assert.match(detailClient, /mutate\(detail\.business\.id, detail\.business\.updatedAt\)/);
});

test("legacy update-business endpoint remains but can patch only safe profile fields", () => {
  assert.equal(existsSync(new URL("app/api/admin/update-business/route.ts", root)), true);
  const patchBlock = legacyBusinessRoute.slice(
    legacyBusinessRoute.indexOf("async function updateBusiness"),
    legacyBusinessRoute.indexOf("export async function POST"),
  );
  const patchBody = patchBlock.slice(
    patchBlock.indexOf("body: JSON.stringify"),
    patchBlock.indexOf("}),", patchBlock.indexOf("body: JSON.stringify")),
  );
  assert.match(patchBlock, /method: "PATCH"/);
  for (const field of [
    "subscription_status",
    "subscription_started_at",
    "subscription_expires_at",
    "is_active",
    "subscriptionStatus",
    "subscriptionStartedAt",
    "subscriptionExpiresAt",
    "isActive",
  ]) {
    assert.doesNotMatch(patchBody, new RegExp(field));
  }
});

test("dedicated safe edit and hard delete remain intact", () => {
  assert.match(safeBusinessRoute, /export async function PATCH/);
  assert.match(safeBusinessRoute, /parseAdminBusinessSafePatch\(body\)/);
  assert.match(safeBusinessAdapter, /buildAdminBusinessSafePatchParams\(businessId, patch\.expectedUpdatedAt\)/);
  for (const field of [
    "name",
    "slug",
    "description",
    "category",
    "whatsapp_order_number",
    "city",
    "district",
    "neighborhood",
    "address",
  ]) {
    assert.match(safeBusinessAdapter, new RegExp(`${field}: patch\\.`));
  }
  assert.equal(existsSync(new URL("app/api/admin/delete-business/route.ts", root)), true);
  assert.match(detailClient, /deleteBusinessInSupabase/);
});

test("successful explicit refresh clears stale conflict while initial and failed loads do not", () => {
  const loadDetail = detailClient.slice(
    detailClient.indexOf("const loadDetail"),
    detailClient.indexOf("useEffect(() =>", detailClient.indexOf("const loadDetail")),
  );
  const explicitRefresh = detailClient.slice(
    detailClient.indexOf("async function loadLatestAfterConflict"),
    detailClient.indexOf("async function commitCriticalAction"),
  );
  assert.doesNotMatch(loadDetail, /setConflict\(false\)/);
  assert.match(explicitRefresh, /const latest = await loadDetail\(\)/);
  assert.match(explicitRefresh, /if \(!latest\) return;/);
  assert.ok(explicitRefresh.indexOf("if (!latest) return;") < explicitRefresh.indexOf("setConflict(false)"));
  assert.match(detailClient, /onRefresh=\{loadLatestAfterConflict\}/);
  assert.match(detailClient, /onClick=\{loadLatestAfterConflict\}/);
});

test("P5.1E-D does not touch PR #7 print or PR #8 reports files", () => {
  const baseSha = "a6833e7d775bfca05a8457e60161cb1f0cad5857";
  const committed = execFileSync("git", ["diff", "--name-only", `${baseSha}...HEAD`], {
    cwd: root,
    encoding: "utf8",
  });
  const working = execFileSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  const changed = new Set(
    `${committed}\n${working}\n${untracked}`.split(/\r?\n/).filter(Boolean),
  );
  const outOfScope = [
    "shared/print-contract/fixtures.ts",
    "shared/print-contract/hash.ts",
    "shared/print-contract/index.ts",
    "shared/print-contract/materialize.ts",
    "shared/print-contract/print-contract.test.ts",
    "shared/print-contract/sanitize.ts",
    "shared/print-contract/types.ts",
    "shared/print-contract/validate.ts",
    "supabase/migrations/20260811003255_add_print_job_foundation.sql",
    "supabase/tests/print-job-foundation-migration.test.ts",
    "app/api/business/reports/route.test.ts",
    "app/api/business/reports/route.ts",
    "lib/business-reports.test.ts",
    "lib/business-reports.ts",
    "supabase/migrations/20260811153000_add_business_reports_rpc.sql",
    "supabase/migrations/business-reports-migration.test.ts",
    "test/resolve-typescript.mjs",
  ];
  assert.deepEqual(outOfScope.filter((path) => changed.has(path)), []);
});
