import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  POST,
  buildProfilePayload,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./route.ts";
import {
  LEGACY_DELIVERY_STATUS_SENTINEL,
  getDisplayDeliveryStatus,
  isLegacyDeliveryStatusSentinel,
  normalizeDeliveryStatus,
} from "../../../../lib/delivery-settings";
import {
  toProfileForm,
  toProfileInput,
  type ProfileForm,
} from "../../../panel/profile-form";
import type { BusinessPanelBusiness } from "../../../../lib/supabase-business";

const root = new URL("../../../../", import.meta.url);
const readSource = (path: string) => readFileSync(new URL(path, root), "utf8");

const validBusinessId = "22222222-2222-4222-8222-222222222222";
const testUserId = "44444444-4444-4444-8444-444444444444";
const otherUserId = "55555555-5555-5555-8555-555555555555";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key";
process.env.SUPABASE_SERVER_SECRET_KEY = "server-secret-key";

// ==================================================
// A. Delivery Normalization Helper Tests
// ==================================================

test("A1: normalizeDeliveryStatus handles null, empty, whitespace and sentinel", () => {
  assert.equal(normalizeDeliveryStatus(null), null);
  assert.equal(normalizeDeliveryStatus(undefined), null);
  assert.equal(normalizeDeliveryStatus(""), null);
  assert.equal(normalizeDeliveryStatus("   "), null);
  assert.equal(normalizeDeliveryStatus(LEGACY_DELIVERY_STATUS_SENTINEL), null);
  assert.equal(
    normalizeDeliveryStatus(`  ${LEGACY_DELIVERY_STATUS_SENTINEL}  `),
    null,
  );
  assert.equal(
    normalizeDeliveryStatus("teslimat bilgisi eklenmedi"),
    null,
  );
});

test("A2: normalizeDeliveryStatus preserves valid custom delivery texts", () => {
  assert.equal(
    normalizeDeliveryStatus("Paket servis ve gel-al"),
    "Paket servis ve gel-al",
  );
  assert.equal(
    normalizeDeliveryStatus("  Sadece Gel-Al  "),
    "Sadece Gel-Al",
  );
  assert.equal(
    normalizeDeliveryStatus("Belirli mahallelere teslimat"),
    "Belirli mahallelere teslimat",
  );
});

test("A3: getDisplayDeliveryStatus returns empty string for sentinel, null or whitespace", () => {
  assert.equal(getDisplayDeliveryStatus(null), "");
  assert.equal(getDisplayDeliveryStatus(undefined), "");
  assert.equal(getDisplayDeliveryStatus(""), "");
  assert.equal(getDisplayDeliveryStatus("   "), "");
  assert.equal(getDisplayDeliveryStatus(LEGACY_DELIVERY_STATUS_SENTINEL), "");
  assert.equal(
    getDisplayDeliveryStatus(`  ${LEGACY_DELIVERY_STATUS_SENTINEL}  `),
    "",
  );
  assert.equal(
    getDisplayDeliveryStatus("Paket servis ve gel-al"),
    "Paket servis ve gel-al",
  );
});

// ==================================================
// B. Public UI Behavior Tests
// ==================================================

test("B1: Public UI orderInfoItems omits legacy sentinel and renders only valid badges", () => {
  function formatPrice(amount: number) {
    return `${amount} TL`;
  }

  function computeOrderInfoItems(business: {
    deliveryStatus: string | null;
    minimumOrderAmount: number | null;
    preparationTimeMinutes: number | null;
  }) {
    return [
      getDisplayDeliveryStatus(business.deliveryStatus),
      business.minimumOrderAmount !== null
        ? `Min. ${formatPrice(business.minimumOrderAmount)}`
        : "",
      business.preparationTimeMinutes !== null
        ? `Tahmini ${business.preparationTimeMinutes} dk`
        : "",
    ].filter(Boolean);
  }

  // Case 1: Legacy sentinel with no minimum or preparation time -> completely empty list
  const items1 = computeOrderInfoItems({
    deliveryStatus: "Teslimat bilgisi eklenmedi",
    minimumOrderAmount: null,
    preparationTimeMinutes: null,
  });
  assert.deepEqual(items1, []);

  // Case 2: Legacy sentinel with minimum order and preparation time -> only min & prep badges
  const items2 = computeOrderInfoItems({
    deliveryStatus: "Teslimat bilgisi eklenmedi",
    minimumOrderAmount: 150,
    preparationTimeMinutes: 30,
  });
  assert.deepEqual(items2, ["Min. 150 TL", "Tahmini 30 dk"]);
  assert.ok(!items2.includes("Teslimat bilgisi eklenmedi"));

  // Case 3: Valid custom delivery text with min & prep -> all 3 badges present
  const items3 = computeOrderInfoItems({
    deliveryStatus: "Paket servis ve gel-al",
    minimumOrderAmount: 200,
    preparationTimeMinutes: 25,
  });
  assert.deepEqual(items3, [
    "Paket servis ve gel-al",
    "Min. 200 TL",
    "Tahmini 25 dk",
  ]);
});

test("B2: Public customer page and homepage source files integrate delivery normalization", () => {
  const publicClient = readSource(
    "app/isletme/[slug]/PublicBusinessPageClient.tsx",
  );
  const homeClient = readSource("app/HomePageClient.tsx");
  const publicServer = readSource("lib/public-business-server.ts");

  assert.match(
    publicClient,
    /getDisplayDeliveryStatus\(currentBusiness\.deliveryStatus\)/,
  );
  assert.match(
    homeClient,
    /getDisplayDeliveryStatus\(business\.deliveryStatus\)/,
  );
  assert.match(
    publicServer,
    /deliveryStatus:\s*getDisplayDeliveryStatus\(row\.delivery_status\)/,
  );
});

// ==================================================
// C. Business Panel Form Tests
// ==================================================

function createMockBusiness(
  overrides: Partial<BusinessPanelBusiness> = {},
): BusinessPanelBusiness {
  return {
    id: validBusinessId,
    ownerId: testUserId,
    slug: "test-restoran",
    name: "Test Restoran",
    description: "Açıklama",
    whatsappOrderNumber: "05550000000",
    email: "test@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    category: "Restoran",
    city: "Ankara",
    district: "Çankaya",
    neighborhood: "Kızılay",
    address: "Atatürk Bulvarı No: 1",
    deliveryStatus: "Teslimat bilgisi eklenmedi",
    paymentMethodMode: "cash_or_card",
    minimumOrderAmount: 100,
    preparationTimeMinutes: 20,
    isOpen: true,
    orderNote: null,
    logoText: "TR",
    logoUrl: null,
    coverImageUrl: null,
    latitude: 39.92,
    longitude: 32.85,
    serviceRadiusKm: 5,
    subscriptionStatus: "active",
    subscriptionStartedAt: "2026-01-01T00:00:00.000Z",
    subscriptionExpiresAt: "2026-12-31T23:59:59.000Z",
    isActive: true,
    productCategories: [],
    ...overrides,
  };
}

test("C1: toProfileForm normalizes legacy sentinel to empty string", () => {
  const businessWithSentinel = createMockBusiness({
    deliveryStatus: "Teslimat bilgisi eklenmedi",
  });
  const form = toProfileForm(businessWithSentinel);
  assert.equal(form.deliveryStatus, "");
});

test("C2: toProfileForm preserves valid custom delivery text", () => {
  const businessWithCustom = createMockBusiness({
    deliveryStatus: "Paket servis ve gel-al",
  });
  const form = toProfileForm(businessWithCustom);
  assert.equal(form.deliveryStatus, "Paket servis ve gel-al");
});

test("C3: toProfileInput converts empty, whitespace or legacy sentinel to null", () => {
  const baseForm: ProfileForm = {
    name: "Test Restoran",
    description: "",
    whatsappOrderNumber: "",
    city: "Ankara",
    district: "Çankaya",
    neighborhood: "Kızılay",
    address: "Adres",
    deliveryStatus: "",
    paymentMethodMode: "cash",
    minimumOrderAmount: "",
    preparationTimeMinutes: "",
    isOpen: true,
    orderNote: "",
    serviceRadiusKm: "",
    logoUrl: "",
    coverImageUrl: "",
  };

  const inputEmpty = toProfileInput({ ...baseForm, deliveryStatus: "" });
  assert.equal(inputEmpty.deliveryStatus, null);

  const inputWhitespace = toProfileInput({
    ...baseForm,
    deliveryStatus: "    ",
  });
  assert.equal(inputWhitespace.deliveryStatus, null);

  const inputSentinel = toProfileInput({
    ...baseForm,
    deliveryStatus: "Teslimat bilgisi eklenmedi",
  });
  assert.equal(inputSentinel.deliveryStatus, null);

  const inputValid = toProfileInput({
    ...baseForm,
    deliveryStatus: "Paket servis ve gel-al",
  });
  assert.equal(inputValid.deliveryStatus, "Paket servis ve gel-al");
});

test("C4: Panel UI includes placeholder and help text for delivery status", () => {
  const panelSource = readSource("app/panel/page.tsx");
  assert.match(panelSource, /placeholder="Örn: Paket servis ve gel-al"/);
  assert.match(
    panelSource,
    /Müşteri sayfasında rozet olarak gösterilir\. Boş bırakırsanız teslimat rozeti gizlenir\./,
  );
});

// ==================================================
// D. API Validation & Route Hardening Tests
// ==================================================

test("D1: buildProfilePayload normalizes delivery_status to null when empty or legacy sentinel", () => {
  const emptyPayload = buildProfilePayload({ delivery_status: "" });
  assert.equal(emptyPayload.delivery_status, null);

  const whitespacePayload = buildProfilePayload({ delivery_status: "   " });
  assert.equal(whitespacePayload.delivery_status, null);

  const sentinelPayload = buildProfilePayload({
    delivery_status: "Teslimat bilgisi eklenmedi",
  });
  assert.equal(sentinelPayload.delivery_status, null);

  const nullPayload = buildProfilePayload({ delivery_status: null });
  assert.equal(nullPayload.delivery_status, null);

  const validPayload = buildProfilePayload({
    delivery_status: "  Paket servis ve gel-al  ",
  });
  assert.equal(validPayload.delivery_status, "Paket servis ve gel-al");
});

test("D2: buildProfilePayload rejects overlong delivery_status (> 120 chars)", () => {
  assert.throws(
    () => buildProfilePayload({ delivery_status: "A".repeat(121) }),
    { message: "Teslimat bilgisi en fazla 120 karakter olabilir." },
  );
});

test("D3: buildProfilePayload rejects overlong order_note (> 300 chars)", () => {
  assert.throws(
    () => buildProfilePayload({ order_note: "N".repeat(301) }),
    { message: "Siparis notu en fazla 300 karakter olabilir." },
  );
});

test("D4: buildProfilePayload validates business name (non-empty, max 120 chars)", () => {
  assert.throws(() => buildProfilePayload({ name: "" }), {
    message: "İşletme adı boş olamaz.",
  });
  assert.throws(() => buildProfilePayload({ name: "   " }), {
    message: "İşletme adı boş olamaz.",
  });
  assert.throws(() => buildProfilePayload({ name: null }), {
    message: "İşletme adı boş olamaz.",
  });
  assert.throws(() => buildProfilePayload({ name: "B".repeat(121) }), {
    message: "İşletme adı en fazla 120 karakter olabilir.",
  });

  const valid = buildProfilePayload({ name: "  Örnek Lezzetler  " });
  assert.equal(valid.name, "Örnek Lezzetler");
});

test("D5: buildProfilePayload validates whatsapp_order_number length (max 30 chars)", () => {
  assert.throws(
    () => buildProfilePayload({ whatsapp_order_number: "0".repeat(31) }),
    { message: "WhatsApp sipariş numarası en fazla 30 karakter olabilir." },
  );
  const valid = buildProfilePayload({ whatsapp_order_number: "05551234567" });
  assert.equal(valid.whatsapp_order_number, "05551234567");
});

test("D6: buildProfilePayload validates payment_method_mode", () => {
  assert.throws(
    () => buildProfilePayload({ payment_method_mode: "crypto_only" }),
    { message: "Lütfen geçerli bir ödeme kabul yöntemi seçin." },
  );
  for (const validMode of [
    "cash",
    "card",
    "cash_or_card",
  ]) {
    const res = buildProfilePayload({ payment_method_mode: validMode });
    assert.equal(res.payment_method_mode, validMode);
  }
});

test("D7: buildProfilePayload validates numeric fields and ranges", () => {
  assert.throws(
    () => buildProfilePayload({ service_radius_km: -1 }),
    { message: "service_radius_km alani gecerli bir sayi olmalidir." },
  );
  assert.throws(
    () => buildProfilePayload({ minimum_order_amount: -10 }),
    { message: "Minimum siparis tutari gecerli bir sayi olmalidir." },
  );
  assert.throws(
    () => buildProfilePayload({ preparation_time_minutes: 0 }),
    {
      message: "Hazirlik suresi 1 ile 720 dakika arasinda tam sayi olmalidir.",
    },
  );
  assert.throws(
    () => buildProfilePayload({ preparation_time_minutes: 721 }),
    {
      message: "Hazirlik suresi 1 ile 720 dakika arasinda tam sayi olmalidir.",
    },
  );
  assert.throws(
    () => buildProfilePayload({ preparation_time_minutes: 15.5 }),
    {
      message: "Hazirlik suresi 1 ile 720 dakika arasinda tam sayi olmalidir.",
    },
  );

  const valid = buildProfilePayload({
    service_radius_km: 10,
    minimum_order_amount: 150,
    preparation_time_minutes: 30,
    is_open: true,
  });
  assert.equal(valid.service_radius_km, 10);
  assert.equal(valid.minimum_order_amount, 150);
  assert.equal(valid.preparation_time_minutes, 30);
  assert.equal(valid.is_open, true);
});

test("D8: buildProfilePayload rejects forbidden fields and empty payloads", () => {
  for (const forbidden of [
    "subscription_status",
    "subscriptionStatus",
    "id",
    "owner_id",
    "ownerId",
    "is_active",
    "isActive",
    "deliveryStatus",
  ]) {
    assert.throws(() => buildProfilePayload({ [forbidden]: "malicious" }), {
      message: "Profil bilgileri gecersiz.",
    });
  }

  assert.throws(() => buildProfilePayload({}), {
    message: "Guncellenecek profil alani bulunamadi.",
  });
});

// ==================================================
// Route Integration Tests (POST HTTP handler)
// ==================================================

type Scenario = {
  authValid?: boolean;
  businessExists?: boolean;
  businessOwnerId?: string;
  updateSucceeds?: boolean;
};

function createProfileScenarioFetch(scenario: Scenario = {}) {
  const originalFetch = globalThis.fetch;
  const mockFetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));

    if (url.pathname === "/auth/v1/user") {
      if (scenario.authValid === false) {
        return Response.json({}, { status: 401 });
      }
      return Response.json({ id: testUserId });
    }

    if (
      url.pathname === "/rest/v1/businesses" &&
      init.method !== "PATCH"
    ) {
      if (scenario.businessExists === false) {
        return Response.json([]);
      }
      return Response.json([
        {
          id: validBusinessId,
          owner_id: scenario.businessOwnerId ?? testUserId,
          city: "Ankara",
          district: "Çankaya",
          neighborhood: "Kızılay",
        },
      ]);
    }

    if (
      url.pathname === "/rest/v1/businesses" &&
      init.method === "PATCH"
    ) {
      if (scenario.updateSucceeds === false) {
        return Response.json({ error: "db_fail" }, { status: 500 });
      }
      const parsedBody = JSON.parse(String(init.body || "{}"));
      return Response.json([
        {
          id: validBusinessId,
          ...parsedBody,
        },
      ]);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  };

  return {
    enable: () => {
      globalThis.fetch = mockFetch;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test("D9: POST handler returns 401 when Authorization header is missing or invalid", async () => {
  const reqNoAuth = new Request(
    "http://localhost:3000/api/business/update-profile",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: validBusinessId,
        input: { name: "Test" },
      }),
    },
  );
  const resNoAuth = await POST(reqNoAuth);
  assert.equal(resNoAuth.status, 401);
  const jsonNoAuth = await resNoAuth.json();
  assert.equal(jsonNoAuth.error, "Oturum bulunamadi.");

  const env = createProfileScenarioFetch({ authValid: false });
  env.enable();
  try {
    const reqBadAuth = new Request(
      "http://localhost:3000/api/business/update-profile",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid_token",
        },
        body: JSON.stringify({
          businessId: validBusinessId,
          input: { name: "Test" },
        }),
      },
    );
    const resBadAuth = await POST(reqBadAuth);
    assert.equal(resBadAuth.status, 401);
    const jsonBadAuth = await resBadAuth.json();
    assert.equal(jsonBadAuth.error, "Gecersiz veya suresi dolmus oturum.");
  } finally {
    env.restore();
  }
});

test("D10: POST handler enforces business ownership (404 / 403)", async () => {
  // 404: Business not found
  const notFoundEnv = createProfileScenarioFetch({ businessExists: false });
  notFoundEnv.enable();
  try {
    const req = new Request(
      "http://localhost:3000/api/business/update-profile",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid_token",
        },
        body: JSON.stringify({
          businessId: validBusinessId,
          input: { name: "Test" },
        }),
      },
    );
    const res = await POST(req);
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.equal(json.error, "Isletme bulunamadi.");
  } finally {
    notFoundEnv.restore();
  }

  // 403: Business belongs to another user
  const forbiddenEnv = createProfileScenarioFetch({
    businessOwnerId: otherUserId,
  });
  forbiddenEnv.enable();
  try {
    const req = new Request(
      "http://localhost:3000/api/business/update-profile",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid_token",
        },
        body: JSON.stringify({
          businessId: validBusinessId,
          input: { name: "Test" },
        }),
      },
    );
    const res = await POST(req);
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, "Bu isletmeyi guncelleme yetkiniz yok.");
  } finally {
    forbiddenEnv.restore();
  }
});

test("D11: POST handler normalizes legacy sentinel in update request without error", async () => {
  const env = createProfileScenarioFetch({ updateSucceeds: true });
  env.enable();
  try {
    const req = new Request(
      "http://localhost:3000/api/business/update-profile",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid_token",
        },
        body: JSON.stringify({
          businessId: validBusinessId,
          input: {
            delivery_status: "Teslimat bilgisi eklenmedi",
          },
        }),
      },
    );
    const res = await POST(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.business.delivery_status, null);
  } finally {
    env.restore();
  }
});

test("D12: POST handler preserves valid custom delivery status", async () => {
  const env = createProfileScenarioFetch({ updateSucceeds: true });
  env.enable();
  try {
    const req = new Request(
      "http://localhost:3000/api/business/update-profile",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid_token",
        },
        body: JSON.stringify({
          businessId: validBusinessId,
          input: {
            delivery_status: "Paket servis ve gel-al",
          },
        }),
      },
    );
    const res = await POST(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.business.delivery_status, "Paket servis ve gel-al");
  } finally {
    env.restore();
  }
});
