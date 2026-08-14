import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ADMIN_BUSINESS_DETAIL_SELECT,
  ADMIN_ORDER_SUMMARY_SELECT,
  ADMIN_RECENT_ORDER_LIMIT,
  AdminBusinessDetailContractError,
  buildAdminBusinessSafePatchParams,
  isCanonicalUuid,
  normalizeAdminBusinessSlug,
  parseAdminBusinessSafePatch,
  // @ts-expect-error Node's type-stripping test runner requires the source extension.
} from "./business-detail-contract.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const route = source("app/api/admin/businesses/[id]/route.ts");
const dal = source("lib/admin/business-detail.ts");
const contract = source("lib/admin/business-detail-contract.ts");
const client = source("app/admin/isletmeler/[id]/business-detail-client.tsx");
const listPage = source("app/admin/page.tsx");
const adminHttp = source("lib/admin/http.ts");

const businessId = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-08-14T10:00:00.000Z";

test("canonical business UUID is accepted and slug-like identifiers are rejected", () => {
  assert.equal(isCanonicalUuid(businessId), true);
  assert.equal(isCanonicalUuid("demo-kebap"), false);
  assert.equal(isCanonicalUuid("11111111-1111-1111-1111-111111111111"), false);
});

test("safe patch trims names and normalizes Turkish slug characters", () => {
  assert.deepEqual(
    parseAdminBusinessSafePatch({
      name: "  Örnek İşletme  ",
      slug: " Örnek İşletme ",
      expectedUpdatedAt: updatedAt,
    }),
    { name: "Örnek İşletme", slug: "ornek-isletme", expectedUpdatedAt: updatedAt },
  );
  assert.equal(normalizeAdminBusinessSlug("ÇĞIÖŞÜ test"), "cgiosu-test");
});

test("safe patch rejects empty names and slugs", () => {
  assert.throws(
    () => parseAdminBusinessSafePatch({ name: " ", slug: "ok", expectedUpdatedAt: updatedAt }),
    AdminBusinessDetailContractError,
  );
  assert.throws(
    () => parseAdminBusinessSafePatch({ name: "Ok", slug: "---", expectedUpdatedAt: updatedAt }),
    AdminBusinessDetailContractError,
  );
});

test("safe patch rejects missing or invalid concurrency versions", () => {
  assert.throws(
    () => parseAdminBusinessSafePatch({ name: "Ok", slug: "ok", expectedUpdatedAt: "display date" }),
    AdminBusinessDetailContractError,
  );
});

test("safe patch is an exact allowlist", () => {
  for (const forbidden of ["isActive", "subscriptionStatus", "ownerId", "isOpen"]) {
    assert.throws(
      () => parseAdminBusinessSafePatch({
        name: "Ok",
        slug: "ok",
        expectedUpdatedAt: updatedAt,
        [forbidden]: true,
      }),
      AdminBusinessDetailContractError,
    );
  }
});

test("concurrency filter always contains both UUID and raw updated_at", () => {
  const params = buildAdminBusinessSafePatchParams(businessId, updatedAt);
  assert.equal(params.get("id"), `eq.${businessId}`);
  assert.equal(params.get("updated_at"), `eq.${updatedAt}`);
  assert.equal(params.get("select"), "id,name,slug,updated_at");
});

test("two-tab stale edit cannot overwrite the newer row", () => {
  const row = { name: "İlk", slug: "ilk", updatedAt };
  const apply = (expected: string, name: string, nextUpdatedAt: string) => {
    const filters = buildAdminBusinessSafePatchParams(businessId, expected);
    if (filters.get("updated_at") !== `eq.${row.updatedAt}`) return false;
    row.name = name;
    row.updatedAt = nextUpdatedAt;
    return true;
  };

  const tabA = row.updatedAt;
  const tabB = row.updatedAt;
  assert.equal(apply(tabA, "A güncelledi", "2026-08-14T10:01:00.000Z"), true);
  assert.equal(apply(tabB, "B ezdi", "2026-08-14T10:02:00.000Z"), false);
  assert.equal(row.name, "A güncelledi");
});

test("detail route uses async params, requireAdmin and same-origin CSRF", () => {
  assert.match(route, /params:\s*Promise<\{ id: string \}>/);
  assert.equal((route.match(/requireAdmin\(\)/g) ?? []).length, 2);
  assert.match(route, /assertSameOriginAdminMutation\(request\)/);
  assert.match(route, /isCanonicalUuid/);
});

test("detail route returns controlled invalid, not-found and conflict codes", () => {
  assert.match(route, /invalidAdminRequest/);
  assert.match(route, /"NOT_FOUND"/);
  assert.match(dal, /"CONFLICT"/);
  assert.match(dal, /"DUPLICATE_SLUG"/);
  assert.doesNotMatch(`${route}\n${dal}`, /console\.(log|warn|error)/);
});

test("detail response uses explicit business and no-PII order selects", () => {
  assert.doesNotMatch(ADMIN_BUSINESS_DETAIL_SELECT, /\*/);
  assert.doesNotMatch(ADMIN_ORDER_SUMMARY_SELECT, /customer|address|note|phone/i);
  assert.doesNotMatch(`${contract}\n${dal}`, /select=\*|select\("\*"\)/);
  for (const field of ["customer_name", "customer_phone", "customer_address", "customer_note"]) {
    assert.doesNotMatch(ADMIN_ORDER_SUMMARY_SELECT, new RegExp(field));
  }
});

test("owner query requests email only and detail storage remains ephemeral", () => {
  assert.match(dal, /select:\s*"email"/);
  assert.doesNotMatch(client, /localStorage\.setItem|sessionStorage\.setItem/);
  assert.doesNotMatch(client, /console\.(log|warn|error)/);
});

test("product and order counts use HEAD exact count without row arrays", () => {
  assert.match(dal, /method:\s*"HEAD"/);
  assert.match(dal, /Prefer:\s*"count=exact"/);
  assert.match(dal, /countRows\("products"/);
  assert.match(dal, /countRows\("orders"/);
});

test("last and recent orders use stable PII-free queries with a five-row limit", () => {
  assert.equal(ADMIN_RECENT_ORDER_LIMIT, 5);
  assert.match(dal, /order:\s*"created_at\.desc,id\.desc"/);
  assert.match(dal, /fetchOrders\(businessId, 1\)/);
  assert.match(dal, /fetchOrders\(businessId, ADMIN_RECENT_ORDER_LIMIT\)/);
});

test("safe update sends only name and slug and distinguishes stale from missing", () => {
  assert.match(dal, /JSON\.stringify\(\{ name: patch\.name, slug: patch\.slug \}\)/);
  assert.doesNotMatch(dal, /JSON\.stringify\(patch\)/);
  assert.match(dal, /businessExists\(businessId\)/);
  assert.match(dal, /başka bir işlemde güncellendi/);
});

test("detail GET and PATCH inherit private no-store Cookie responses", () => {
  assert.match(route, /adminJson/);
  assert.match(adminHttp, /private, no-store, max-age=0/);
  assert.match(adminHttp, /Vary:\s*"Cookie"/);
});

test("list detail action navigates by immutable business UUID", () => {
  assert.match(listPage, /href=\{`\/admin\/isletmeler\/\$\{business\.id\}`\}/);
  assert.doesNotMatch(listPage, /href=\{`\/admin\/isletmeler\/\$\{business\.slug\}`\}/);
});

test("conflict UX keeps edits and requires an explicit latest-data reload", () => {
  assert.match(client, /setConflict\(error\.code === "CONFLICT"\)/);
  assert.match(client, /Güncel Bilgileri Yükle/);
  assert.match(client, /loadLatestAfterConflict/);
});

test("safe edit waits for PATCH success before changing persistent detail state", () => {
  const save = client.slice(client.indexOf("async function saveEdit"), client.indexOf("async function loadLatestAfterConflict"));
  assert.ok(save.indexOf("await updateAdminBusinessSafely") < save.indexOf("setDetail"));
});

test("legacy access, subscription and delete capabilities remain on the detail page", () => {
  for (const label of [
    "Pasife Al",
    "Aktife Al",
    "Engelle",
    "Aboneliği Sıfırla",
    "Kalıcı Sil",
  ]) {
    assert.match(client, new RegExp(label.replace("+", "\\+")));
  }
  assert.match(client, /const extensionDays = \[30, 60, 90, 180, 365\]/);
  assert.match(client, /updateBusinessSubscriptionInSupabase/);
  assert.match(client, /deleteBusinessInSupabase/);
});

test("detail layout includes all required read-only and operational sections", () => {
  for (const heading of [
    "Temel bilgiler",
    "İşletme sahibi",
    "Erişim ve abonelik",
    "İşletme ayarları",
    "Operasyon özeti",
    "Son siparişler",
    "Kritik işlemler",
  ]) {
    assert.match(client, new RegExp(heading, "i"));
  }
});
