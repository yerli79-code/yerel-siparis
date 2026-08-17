import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Business } from "../../lib/businesses";
// @ts-expect-error Node's type-stripping test runner requires the source extension.
import { calculateAdminKpis, canActivateBusiness, canReactivateBusinessAccess, getAdminSubscriptionStatusLabel, withBusinessAccess, withReactivatedBusinessAccess } from "../../lib/subscription.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const loginSource = source("app/admin/_components/admin-login.tsx");
const shellSource = source("app/admin/_components/admin-shell.tsx");
const overviewSource = source("app/admin/_components/admin-overview.tsx");
const dashboardSource = source("lib/subscription.ts");
const adminPageSource = source("app/admin/page.tsx");
const businessDetailSource = source(
  "app/admin/isletmeler/[id]/business-detail-client.tsx",
);
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
  assert.ok(createFormSource);
  assert.doesNotMatch(adminPageSource, />Supabase businesses</);
  assert.equal((adminPageSource.match(/>İşletme kaydı</g) ?? []).length, 1);

  assert.match(createFormSource, /<option value="active">Aktif<\/option>/);
  assert.match(createFormSource, /<option value="expired">Süresi Dolmuş<\/option>/);
  assert.match(createFormSource, /<option value="blocked">Engelli<\/option>/);
  assert.doesNotMatch(businessDetailSource, /<option value="(?:active|expired|blocked)"/);

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

  assert.match(adminPageSource, /function submitNewBusiness\(/);
  for (const handler of ["saveEdit", "deleteBusiness", "commitSubscription"]) {
    assert.match(businessDetailSource, new RegExp(`function ${handler}\\(`));
  }
});

test("passive access preserves active subscription state and dates", () => {
  const startedAt = "2026-08-01T00:00:00.000Z";
  const expiresAt = "2026-10-01T00:00:00.000Z";
  const current = business({
    slug: "active-business",
    subscriptionStatus: "active",
    subscriptionStartedAt: startedAt,
    subscriptionExpiresAt: expiresAt,
    isActive: true,
  });

  const next = withBusinessAccess(current, false);

  assert.equal(next.subscriptionStatus, "active");
  assert.equal(next.subscriptionStartedAt, startedAt);
  assert.equal(next.subscriptionExpiresAt, expiresAt);
  assert.equal(next.isActive, false);
});

test("valid passive business can be reactivated without changing subscription", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const startedAt = "2026-08-01T00:00:00.000Z";
  const expiresAt = "2026-10-01T00:00:00.000Z";
  const current = business({
    slug: "passive-business",
    subscriptionStatus: "active",
    subscriptionStartedAt: startedAt,
    subscriptionExpiresAt: expiresAt,
    isActive: false,
  });

  const next = withReactivatedBusinessAccess(current, now);

  assert.ok(next);
  assert.equal(next.subscriptionStatus, "active");
  assert.equal(next.subscriptionStartedAt, startedAt);
  assert.equal(next.subscriptionExpiresAt, expiresAt);
  assert.equal(next.isActive, true);
});

test("expired, blocked, missing and elapsed subscriptions cannot be reactivated", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const future = "2026-10-01T00:00:00.000Z";
  const elapsed = "2026-08-01T00:00:00.000Z";
  const cases = [
    business({ slug: "expired", subscriptionStatus: "expired", subscriptionExpiresAt: future }),
    business({ slug: "blocked", subscriptionStatus: "blocked", subscriptionExpiresAt: future }),
    business({ slug: "missing", subscriptionStatus: "active", subscriptionExpiresAt: null }),
    business({ slug: "elapsed", subscriptionStatus: "active", subscriptionExpiresAt: elapsed }),
  ];

  for (const current of cases) {
    assert.equal(canActivateBusiness(current, now), false);
    assert.equal(withBusinessAccess(current, true, now), null);
  }
});

test("admin access recovery detects only passive future subscriptions", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const future = "2026-09-13T23:59:59.999Z";
  const past = "2026-08-01T00:00:00.000Z";

  assert.equal(canReactivateBusinessAccess(business({ slug: "normal", subscriptionStatus: "active", subscriptionExpiresAt: future, isActive: false }), now), true);
  assert.equal(canReactivateBusinessAccess(business({ slug: "legacy", subscriptionStatus: "expired", subscriptionExpiresAt: future, isActive: false }), now), true);
  assert.equal(canReactivateBusinessAccess(business({ slug: "past", subscriptionStatus: "expired", subscriptionExpiresAt: past, isActive: false }), now), false);
  assert.equal(canReactivateBusinessAccess(business({ slug: "null", subscriptionStatus: "expired", subscriptionExpiresAt: null, isActive: false }), now), false);
  assert.equal(canReactivateBusinessAccess(business({ slug: "blocked", subscriptionStatus: "blocked", subscriptionExpiresAt: future, isActive: false }), now), false);
  assert.equal(canReactivateBusinessAccess(business({ slug: "invalid", subscriptionStatus: "expired", subscriptionExpiresAt: "invalid", isActive: false }), now), false);
  assert.equal(canReactivateBusinessAccess(business({ slug: "already-active", subscriptionStatus: "active", subscriptionExpiresAt: future, isActive: true }), now), false);
});

test("legacy passive recovery repairs status while preserving subscription dates", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const startedAt = "2026-08-14T00:00:00.000Z";
  const expiresAt = "2026-09-13T23:59:59.999Z";
  const current = business({
    slug: "legacy-passive",
    subscriptionStatus: "expired",
    subscriptionStartedAt: startedAt,
    subscriptionExpiresAt: expiresAt,
    isActive: false,
  });

  assert.equal(canActivateBusiness(current, now), false);
  const next = withReactivatedBusinessAccess(current, now);

  assert.ok(next);
  assert.equal(next.subscriptionStatus, "active");
  assert.equal(next.subscriptionStartedAt, startedAt);
  assert.equal(next.subscriptionExpiresAt, expiresAt);
  assert.equal(next.isActive, true);
});

test("recovered business keeps active subscription through access cycles", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const startedAt = "2026-08-14T00:00:00.000Z";
  const expiresAt = "2026-09-13T23:59:59.999Z";
  const recovered = withReactivatedBusinessAccess(
    business({ slug: "cycle", subscriptionStatus: "expired", subscriptionStartedAt: startedAt, subscriptionExpiresAt: expiresAt, isActive: false }),
    now,
  );

  assert.ok(recovered);
  const passive = withBusinessAccess(recovered, false);
  const activeAgain = withReactivatedBusinessAccess(passive, now);
  const passiveAgain = withBusinessAccess(activeAgain!, false);

  for (const next of [passive, activeAgain!, passiveAgain]) {
    assert.equal(next.subscriptionStatus, "active");
    assert.equal(next.subscriptionStartedAt, startedAt);
    assert.equal(next.subscriptionExpiresAt, expiresAt);
  }
  assert.equal(passive.isActive, false);
  assert.equal(activeAgain!.isActive, true);
  assert.equal(passiveAgain.isActive, false);
});

test("legacy passive records use an explicit admin recovery label", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z");
  const future = "2026-09-13T23:59:59.999Z";
  const legacy = business({ slug: "legacy-label", subscriptionStatus: "expired", subscriptionExpiresAt: future, isActive: false });

  assert.equal(getAdminSubscriptionStatusLabel(legacy, now), "Düzeltme Gerekli");
  assert.equal(getAdminSubscriptionStatusLabel(business({ slug: "real-expired", subscriptionStatus: "expired", subscriptionExpiresAt: null, isActive: false }), now), "Süresi Dolmuş");
  assert.equal(
    (adminPageSource.match(/getAdminSubscriptionStatusLabel\(business\)/g) ?? []).length,
    1,
  );
});

test("critical access control switches copy by state without duplicate activation CTA", () => {
  assert.match(businessDetailSource, /legacyBusiness\.isActive \? \([^]*Pasife Al[^]*\) : canReactivateBusinessAccess\(legacyBusiness\) \? \([^]*Aktife Al[^]*\) : null/);
  assert.match(businessDetailSource, /title: "Pasife al"/);
  assert.match(businessDetailSource, /title: "Aktife al"/);
  assert.match(businessDetailSource, /canReactivateBusinessAccess\(legacyBusiness\)/);
  assert.match(businessDetailSource, /withReactivatedBusinessAccess\(legacyBusiness\)/);
  assert.equal(
    (businessDetailSource.match(/withReactivatedBusinessAccess\(legacyBusiness\)/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(businessDetailSource, />\s*Aktif Et\s*</);
});

test("extension-day buttons use visible soft-green brand actions", () => {
  const genericStyle = adminCss.match(
    /\.mainContent :global\(\.admin-filter-footer button\),([^]*?) \{[^}]*background: var\(--brand-card\)/,
  )?.[1];
  const normalStyle = adminCss.match(
    /\.mainContent :global\(\.admin-extension-actions button\) \{([^}]*)\}/,
  )?.[1];
  const hoverStyle = adminCss.match(
    /\.mainContent :global\(\.admin-extension-actions button:not\(:disabled\):hover\) \{([^}]*)\}/,
  )?.[1];

  assert.ok(genericStyle);
  assert.doesNotMatch(genericStyle, /admin-extension-actions/);
  assert.ok(normalStyle);
  assert.match(normalStyle, /border: 1px solid rgba\(9, 93, 39, 0\.3\)/);
  assert.match(normalStyle, /background: var\(--brand-soft\)/);
  assert.match(normalStyle, /color: var\(--brand-primary\)/);
  assert.match(normalStyle, /box-shadow: 0 4px 12px rgba\(9, 93, 39, 0\.08\)/);
  assert.ok(
    adminCss.indexOf(".admin-extension-actions button) {") >
      adminCss.indexOf(".admin-filter-footer button),"),
  );
  assert.ok(hoverStyle);
  assert.match(hoverStyle, /border-color: var\(--brand-primary\)/);
  assert.match(hoverStyle, /background: var\(--brand-primary\)/);
  assert.match(hoverStyle, /color: var\(--brand-card\)/);
});

test("dashboard KPI presentation stays independent from paginated business rows", () => {
  assert.match(adminPageSource, /fetchAdminOverview/);
  assert.match(adminPageSource, /setAdminKpis\(result\)/);
  assert.doesNotMatch(adminPageSource, /calculateAdminKpis\(businesses\)/);
  assert.doesNotMatch(dashboardSource, /fetch\(|order|localStorage|sessionStorage/i);
});
