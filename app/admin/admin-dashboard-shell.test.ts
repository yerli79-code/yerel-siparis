import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Business } from "../../lib/businesses";
// @ts-expect-error Node's type-stripping test runner requires the source extension.
import { calculateAdminKpis } from "../../lib/subscription.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const loginSource = source("app/admin/_components/admin-login.tsx");
const shellSource = source("app/admin/_components/admin-shell.tsx");
const overviewSource = source("app/admin/_components/admin-overview.tsx");
const dashboardSource = source("lib/subscription.ts");
const adminPageSource = source("app/admin/page.tsx");
const adminCss = source("app/admin/_components/admin.module.css");

function business(
  overrides: Partial<Business> & Pick<Business, "slug">,
): Business {
  const { slug, ...rest } = overrides;

  return {
    slug,
    name: "Test İşletmesi",
    description: "",
    whatsappOrderNumber: "905555555555",
    email: "isletme@example.com",
    createdAt: new Date(0).toISOString(),
    category: "Test",
    district: "Kadıköy",
    neighborhood: "Caferağa",
    address: "Test adresi",
    deliveryStatus: "",
    logoText: "Tİ",
    subscriptionStatus: "expired",
    subscriptionExpiresAt: null,
    isActive: false,
    productCategories: [],
    ...rest,
  };
}

test("admin KPI helper returns zeroes for an empty business list", () => {
  assert.deepEqual(calculateAdminKpis([]), {
    total: 0,
    active: 0,
    inactive: 0,
    createdLastSevenDays: 0,
    activeSubscriptions: 0,
    expiringSubscriptions: 0,
  });
});

test("admin KPI helper counts active and inactive businesses independently from subscription", () => {
  const result = calculateAdminKpis([
    business({ slug: "active", isActive: true }),
    business({ slug: "inactive", isActive: false }),
  ]);

  assert.equal(result.total, 2);
  assert.equal(result.active, 1);
  assert.equal(result.inactive, 1);
});

test("admin KPI helper counts only valid creation dates from the last seven days", () => {
  const now = Date.now();
  const result = calculateAdminKpis(
    [
      business({ slug: "recent", createdAt: new Date(now - 6 * 86_400_000).toISOString() }),
      business({ slug: "old", createdAt: new Date(now - 8 * 86_400_000).toISOString() }),
      business({ slug: "future", createdAt: new Date(now + 86_400_000).toISOString() }),
      business({ slug: "malformed", createdAt: "not-a-date" }),
    ],
    now,
  );

  assert.equal(result.createdLastSevenDays, 1);
});

test("admin KPI helper follows the existing active subscription semantics", () => {
  const future = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const result = calculateAdminKpis([
    business({ slug: "valid", isActive: true, subscriptionStatus: "active", subscriptionExpiresAt: future }),
    business({ slug: "passive", isActive: false, subscriptionStatus: "active", subscriptionExpiresAt: future }),
    business({ slug: "blocked", isActive: true, subscriptionStatus: "blocked", subscriptionExpiresAt: future }),
    business({ slug: "missing", isActive: true, subscriptionStatus: "active", subscriptionExpiresAt: null }),
  ]);

  assert.equal(result.activeSubscriptions, 1);
});

test("admin KPI helper counts valid subscriptions ending within thirty days", () => {
  const result = calculateAdminKpis([
    business({ slug: "soon", isActive: true, subscriptionStatus: "active", subscriptionExpiresAt: new Date(Date.now() + 12 * 86_400_000).toISOString() }),
    business({ slug: "later", isActive: true, subscriptionStatus: "active", subscriptionExpiresAt: new Date(Date.now() + 45 * 86_400_000).toISOString() }),
    business({ slug: "malformed", isActive: true, subscriptionStatus: "active", subscriptionExpiresAt: "invalid" }),
  ]);

  assert.equal(result.expiringSubscriptions, 1);
});

test("admin login exposes accessible fields without implementation provider copy", () => {
  assert.match(loginSource, /htmlFor="adminEmail"[^]*>E-posta</);
  assert.match(loginSource, /autoComplete="username"/);
  assert.match(loginSource, /htmlFor="adminPassword"[^]*>Şifre</);
  assert.match(loginSource, /autoComplete="current-password"/);
  assert.match(loginSource, /type="submit"/);
  assert.match(loginSource, /aria-live="polite"/);
  assert.doesNotMatch(loginSource, /Supabase|service role|token|cookie|\bAPI\b/i);
  assert.doesNotMatch(adminPageSource, /Supabase ID/i);
});

test("admin login, shell and loading use only the public green platform brand", () => {
  const loginBrandTags = loginSource.match(/<PlatformBrand[^>]*\/>/g) ?? [];
  const shellBrandTags = shellSource.match(/<PlatformBrand[^>]*\/>/g) ?? [];

  assert.equal(loginBrandTags.length, 3);
  assert.equal(shellBrandTags.length, 2);

  for (const brandTag of [...loginBrandTags, ...shellBrandTags]) {
    assert.match(brandTag, /publicVariant/);
    assert.doesNotMatch(brandTag, /onDark/);
  }

  assert.doesNotMatch(`${loginSource}\n${shellSource}`, /yerel-siparis-logo\.svg/);
});

test("admin subscription controls keep enum values with Turkish user-facing labels", () => {
  const createFormSource = adminPageSource.match(
    /<section[^>]*id="yeni-isletme"[^]*?<\/form>/,
  )?.[0];
  const editFormSource = adminPageSource.match(
    /<form[^>]*admin-edit-form[^]*?<\/form>/,
  )?.[0];

  assert.ok(createFormSource);
  assert.ok(editFormSource);
  assert.doesNotMatch(adminPageSource, />Supabase businesses</);
  assert.equal((adminPageSource.match(/>İşletme kaydı</g) ?? []).length, 2);

  for (const formSource of [createFormSource, editFormSource]) {
    assert.match(formSource, /<option value="active">Aktif<\/option>/);
    assert.match(formSource, /<option value="expired">Süresi Dolmuş<\/option>/);
    assert.match(formSource, /<option value="blocked">Engelli<\/option>/);
  }

  assert.match(
    adminPageSource,
    /id="adminSubscriptionFilter"[^]*<option value="blocked">Engelli<\/option>/,
  );
  assert.match(adminPageSource, /blocked: "Engelli"/);
  assert.doesNotMatch(adminPageSource, /Engelli \/ blocked/);
  assert.doesNotMatch(adminPageSource, />\s*(?:active|expired|blocked)\s*</);
  assert.doesNotMatch(
    adminPageSource,
    /\{business\.subscriptionStatus\}|\$\{business\.subscriptionStatus\}/,
  );
  assert.match(
    adminPageSource,
    /subscriptionStatus: "active" \| "expired" \| "blocked";/,
  );
});

test("admin shell provides only real overview and business navigation", () => {
  assert.match(shellSource, /<nav[^]*Genel Bakış[^]*İşletmeler[^]*<\/nav>/);
  assert.match(shellSource, /aria-current=/);
  assert.match(shellSource, /Çıkış Yap/);
  assert.doesNotMatch(shellSource, /\/admin\/isletmeler|Raporlar|Audit|Sistem|Abonelikler/);
});

test("mobile admin navigation has an accessible toggle, escape close and inert closed state", () => {
  assert.match(shellSource, /aria-expanded=\{isMobileMenuOpen\}/);
  assert.match(shellSource, /aria-controls="admin-mobile-navigation"/);
  assert.match(shellSource, /event\.key === "Escape"/);
  assert.match(shellSource, /inert=\{!isMobileMenuOpen/);
});

test("admin presentation keeps semantic landmarks, overview anchors and six KPI cards", () => {
  assert.match(shellSource, /<aside/);
  assert.match(shellSource, /<main/);
  assert.match(overviewSource, /id="genel-bakis"/);
  assert.match(adminPageSource, /id="isletmeler"/);
  assert.equal((overviewSource.match(/<AdminKpiCard/g) ?? []).length, 6);
});

test("admin redesign has loading, empty, error and responsive contracts", () => {
  assert.match(loginSource, /aria-busy="true"/);
  assert.match(adminPageSource, /Henüz işletme bulunmuyor\./);
  assert.match(adminPageSource, /İşletmeler yüklenemedi\./);
  assert.match(adminCss, /@media \(max-width: 1023px\)/);
  assert.match(adminCss, /@media \(max-width: 759px\)/);
  assert.match(adminCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("admin visual system follows canonical brand tokens without duplicate overview heading", () => {
  for (const token of [
    "--brand-primary",
    "--brand-accent",
    "--brand-dark",
    "--brand-surface",
    "--brand-soft",
    "--brand-card",
  ]) {
    assert.match(adminCss, new RegExp(`var\\(${token}\\)`));
  }

  assert.doesNotMatch(adminCss, /background: var\(--brand-dark\)/);
  assert.match(overviewSource, /<h2 id="overview-title">Platform Durumu<\/h2>/);
  assert.doesNotMatch(overviewSource, /<h[1-6][^>]*>Genel Bakış<\/h[1-6]>/);

  for (const handler of [
    "submitNewBusiness",
    "submitEditBusiness",
    "deleteBusiness",
    "extendSubscription",
    "setActive",
    "setPassive",
    "blockBusiness",
  ]) {
    assert.match(adminPageSource, new RegExp(`function ${handler}\\(`));
  }
});

test("dashboard KPI implementation stays on loaded businesses without order or storage access", () => {
  assert.match(dashboardSource, /businesses\.reduce/);
  assert.doesNotMatch(dashboardSource, /fetch\(|order|localStorage|sessionStorage/i);
});
