import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the source extension.
import { clearLegacyAdminBusinessCache } from "../admin-client.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const adminPage = source("app/admin/page.tsx");
const businessDetailPage = source(
  "app/admin/isletmeler/[id]/business-detail-client.tsx",
);
const adminClient = source("lib/admin-client.ts");
const adminApiClient = source("lib/supabase-admin.ts");
const listRoute = source("app/api/admin/list-businesses/route.ts");
const listDal = source("lib/admin/business-list.ts");
const listContract = source("lib/admin/business-list-contract.ts");
const overviewRoute = source("app/api/admin/overview/route.ts");
const overviewDal = source("lib/admin/overview.ts");
const adminHttp = source("lib/admin/http.ts");
const businessStorage = source("lib/business-storage.ts");

test("admin startup removes only the exact legacy business cache key", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const removed: string[] = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { removeItem: (key: string) => removed.push(key) } },
  });
  try {
    clearLegacyAdminBusinessCache();
    assert.deepEqual(removed, ["yerel-siparis-businesses-v2"]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("legacy business cleanup tolerates unavailable localStorage", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { removeItem: () => { throw new Error("unavailable"); } } },
  });
  try {
    assert.doesNotThrow(() => clearLegacyAdminBusinessCache());
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("admin browser no longer reads, writes or falls back to the business cache", () => {
  assert.doesNotMatch(adminPage, /business-storage|readBusinesses|writeBusinesses|updateBusiness\(/);
  assert.doesNotMatch(adminApiClient, /fallbackBusinesses|getSeedBusinesses|localStorage/);
  assert.match(adminPage, /clearLegacyAdminBusinessCache\(\)/);
  assert.doesNotMatch(`${adminPage}\n${adminClient}\n${adminApiClient}`, /localStorage\.clear\(/);
});

test("normal storage modules remain intact and are not cleared generically", () => {
  assert.match(businessStorage, /localStorage\.getItem\(key\)/);
  assert.match(businessStorage, /localStorage\.setItem\(key, JSON\.stringify/);
  assert.doesNotMatch(businessStorage, /localStorage\.clear\(/);
  assert.doesNotMatch(source("lib/public-cart-storage.ts"), /localStorage\.clear\(/);
});

test("list endpoint keeps admin auth, controlled validation and private responses", () => {
  assert.match(listRoute, /requireAdmin\(\)/);
  assert.match(listRoute, /parseAdminBusinessListQuery/);
  assert.match(listRoute, /INVALID_REQUEST/);
  assert.match(adminHttp, /private, no-store, max-age=0/);
  assert.match(adminHttp, /Vary:\s*"Cookie"/);
});

test("business query is database-paginated with exact count and explicit fields", () => {
  assert.match(listDal, /Range:\s*`\$\{from\}-\$\{to\}`/);
  assert.match(listDal, /Prefer:\s*"count=exact"/);
  assert.match(listContract, /ADMIN_BUSINESS_LIST_SELECT/);
  assert.doesNotMatch(listContract, /select\("\*"\)|select=\*/);
  assert.doesNotMatch(listDal, /rows\.(filter|sort|slice)\(/);
  assert.match(listDal, /response\.status === 416/);
  assert.match(listDal, /items:\s*\[\]/);
});

test("overview uses six server-side HEAD count queries and no row aggregation", () => {
  assert.match(overviewRoute, /requireAdmin\(\)/);
  assert.match(overviewRoute, /fetchAdminOverview/);
  assert.match(overviewDal, /method:\s*"HEAD"/);
  assert.match(overviewDal, /Prefer:\s*"count=exact"/);
  assert.equal((overviewDal.match(/countBusinesses\(/g) ?? []).length, 7);
  assert.doesNotMatch(overviewDal, /readJsonBody|\.reduce\(|select\("\*"\)/);
});

test("overview active counts exclude passive, blocked and legacy expired rows", () => {
  assert.match(overviewDal, /\["is_active", "eq\.true"\]/);
  assert.match(overviewDal, /\["subscription_status", "eq\.active"\]/);
  assert.match(overviewDal, /\["subscription_expires_at", `gt\.\$\{nowIso\}`\]/);
  assert.match(overviewDal, /lte\.\$\{thirtyDaysLater\}/);
  assert.doesNotMatch(overviewDal, /subscription_status", "eq\.expired/);
});

test("admin search is debounced by 300ms and stale requests cannot win", () => {
  assert.match(adminPage, /window\.setTimeout\(\(\) => \{[\s\S]*setDebouncedSearchQuery[\s\S]*\}, 300\)/);
  assert.match(adminPage, /new AbortController\(\)/);
  assert.match(adminPage, /listRequestSequence\.current/);
  assert.match(adminPage, /sequence !== listRequestSequence\.current/);
});

test("list and overview load failures update only their own error state", () => {
  const listStart = adminPage.indexOf("    loadBusinessPage(");
  const overviewStart = adminPage.indexOf("    loadOverview(controller.signal)");
  const listEffect = adminPage.slice(
    listStart,
    overviewStart,
  );
  const overviewEffect = adminPage.slice(
    overviewStart,
    adminPage.indexOf("  function updateNewBusinessForm", overviewStart),
  );

  assert.match(listEffect, /\.catch\([^]*setBusinessLoadError\(true\)/);
  assert.doesNotMatch(listEffect, /setOverviewLoadError\(true\)/);
  assert.match(overviewEffect, /\.catch\([^]*setOverviewLoadError\(true\)/);
  assert.doesNotMatch(overviewEffect, /setBusinessLoadError\(true\)/);
});

test("search, filters, sort and page size reset pagination", () => {
  for (const setter of [
    "setSearchQuery",
    "setStatusFilter",
    "setSubscriptionFilter",
    "setCreatedFilter",
    "setSort",
    "setCityFilter",
    "setDistrictFilter",
    "setPageSize",
  ]) {
    assert.match(adminPage, new RegExp(`${setter}\\([\\s\\S]{0,180}setPage\\(1\\)`));
  }
});

test("list creation refreshes list and overview while detail mutations refresh detail", () => {
  assert.match(adminPage, /async function refreshAdminData[\s\S]*refreshBusinessesFromSupabase[\s\S]*loadOverview/);
  assert.match(adminPage, /createBusinessWithAccount[\s\S]*await refreshAdminData\(\)/);
  assert.match(businessDetailPage, /updateAdminBusinessSafely[\s\S]*setDetail/);
  assert.match(businessDetailPage, /updateBusinessSubscriptionInSupabase[\s\S]*await loadDetail\(\)/);
});

test("list no longer carries inline deletion and links to the UUID detail page", () => {
  assert.doesNotMatch(adminPage, /deleteBusinessInSupabase/);
  assert.match(adminPage, /href=\{`\/admin\/isletmeler\/\$\{business\.id\}`\}/);
  assert.match(businessDetailPage, /deleteBusinessInSupabase/);
});

test("pagination UI exposes totals, disabled boundaries and responsive controls", () => {
  assert.match(adminPage, /aria-label="İşletme listesi sayfaları"/);
  assert.match(adminPage, /pagination\.page <= 1/);
  assert.match(adminPage, /pagination\.page >= pagination\.totalPages/);
  assert.match(adminPage, /Sayfa \{pagination\.page\} \/ \{pagination\.totalPages\}/);
  assert.match(source("app/admin/_components/admin.module.css"), /admin-pagination/);
});

test("PII-bearing search and business rows are not logged", () => {
  const sources = `${adminPage}\n${adminApiClient}\n${listRoute}\n${listDal}`;
  assert.doesNotMatch(sources, /console\.(log|warn|error)/);
  assert.doesNotMatch(listRoute, /request\.url[^\n]*console/);
});
