import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POST,
  parseReorderItems,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./route.ts";

const productA = "11111111-1111-4111-8111-111111111111";
const productB = "22222222-2222-4222-8222-222222222222";
const businessId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const expectedA = "2026-08-29T06:00:00.000Z";
const expectedB = "2026-08-29T06:00:01.000Z";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const validItems = [
  { productId: productA, sortOrder: 2, expectedUpdatedAt: expectedA },
  { productId: productB, sortOrder: 1, expectedUpdatedAt: expectedB },
];

function productRow(id: string, sortOrder: number, updatedAt: string) {
  return {
    id,
    business_id: businessId,
    client_product_id: `client-${id}`,
    name: id === productA ? "Ürün A" : "Ürün B",
    price: 100,
    description: "",
    category: "Genel",
    image_label: "",
    image_url: null,
    is_active: true,
    sort_order: sortOrder,
    created_at: "2026-08-29T05:00:00.000Z",
    updated_at: updatedAt,
  };
}

type Scenario = {
  authValid?: boolean;
  businessActive?: boolean;
  subscriptionStatus?: string;
  rpcStatus?: number;
  rpcBody?: unknown;
};

function createScenarioFetch(scenario: Scenario = {}) {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === "/auth/v1/user") {
      return scenario.authValid === false
        ? Response.json({}, { status: 401 })
        : Response.json({ id: userId });
    }
    if (url.pathname === "/rest/v1/businesses") {
      return Response.json([
        {
          id: businessId,
          owner_id: userId,
          is_active: scenario.businessActive ?? true,
          subscription_status: scenario.subscriptionStatus ?? "active",
          subscription_expires_at: "2099-12-31T00:00:00.000Z",
        },
      ]);
    }
    if (url.pathname === "/rest/v1/rpc/reorder_business_products_atomic") {
      return Response.json(
        scenario.rpcBody ?? [
          productRow(productB, 1, "2026-08-29T06:00:02.000Z"),
          productRow(productA, 2, "2026-08-29T06:00:02.000Z"),
        ],
        { status: scenario.rpcStatus ?? 200 },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { calls, fetchMock };
}

function request(
  body = JSON.stringify({ items: validItems }),
  authorization = "Bearer valid-token",
) {
  return new Request("https://panel.example.test/api/business/products/reorder", {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
  });
}

async function withScenario(
  scenario: Scenario,
  run: (calls: Array<{ url: URL; init: RequestInit }>) => Promise<void>,
) {
  const previousFetch = globalThis.fetch;
  const { calls, fetchMock } = createScenarioFetch(scenario);
  globalThis.fetch = fetchMock;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = previousFetch;
  }
}

async function code(response: Response) {
  return (await response.json()) as { code?: string; products?: unknown[] };
}

test("strict valid reorder items are parsed", () => {
  assert.deepEqual(parseReorderItems({ items: validItems }), validItems);
});

for (const [name, body] of [
  ["unknown root field", { items: validItems, businessId }],
  ["browser businessId without items", { businessId, items: [] }],
  ["too few items", { items: [validItems[0]] }],
  ["array root", []],
  ["unknown item field", { items: [{ ...validItems[0], name: "spoof" }, validItems[1]] }],
  ["missing item field", { items: [{ productId: productA, sortOrder: 2 }, validItems[1]] }],
  ["duplicate product IDs", { items: [validItems[0], { ...validItems[1], productId: productA }] }],
  ["duplicate sort orders", { items: [validItems[0], { ...validItems[1], sortOrder: 2 }] }],
  ["malformed UUID", { items: [{ ...validItems[0], productId: "demo" }, validItems[1]] }],
  ["non-canonical UUID", { items: [{ ...validItems[0], productId: "11111111-1111-1111-1111-111111111111" }, validItems[1]] }],
  ["malformed expectedUpdatedAt", { items: [{ ...validItems[0], expectedUpdatedAt: "invalid" }, validItems[1]] }],
  ["fractional sort order", { items: [{ ...validItems[0], sortOrder: 1.5 }, validItems[1]] }],
  ["negative sort order", { items: [{ ...validItems[0], sortOrder: -1 }, validItems[1]] }],
] as const) {
  test(`${name} is rejected`, () => {
    assert.throws(
      () => parseReorderItems(body as Record<string, unknown>),
      /INVALID_PRODUCT_MUTATION/,
    );
  });
}

test("oversized request is rejected", () => {
  const items = Array.from({ length: 501 }, (_, index) => ({
    productId: `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
    sortOrder: index,
    expectedUpdatedAt: expectedA,
  }));
  assert.throws(
    () => parseReorderItems({ items }),
    /INVALID_PRODUCT_MUTATION/,
  );
});

test("missing and invalid auth return controlled unauthorized", async () => {
  await withScenario({}, async () => {
    const response = await POST(request(undefined, ""));
    assert.equal(response.status, 401);
    assert.equal((await code(response)).code, "PRODUCT_UNAUTHORIZED");
  });
  await withScenario({ authValid: false }, async () => {
    const response = await POST(request());
    assert.equal(response.status, 401);
    assert.equal((await code(response)).code, "PRODUCT_UNAUTHORIZED");
  });
});

test("business write guard remains enforced", async () => {
  for (const scenario of [
    { businessActive: false },
    { subscriptionStatus: "expired" },
  ]) {
    await withScenario(scenario, async (calls) => {
      const response = await POST(request());
      assert.equal(response.status, 403);
      assert.equal((await code(response)).code, "PRODUCT_FORBIDDEN");
      assert.equal(calls.some(({ url }) => url.pathname.includes("/rpc/")), false);
    });
  }
});

test("RPC receives only server-derived business ownership and strict item versions", async () => {
  await withScenario({}, async (calls) => {
    const response = await POST(request());
    assert.equal(response.status, 200);
    const rpcCall = calls.find(({ url }) =>
      url.pathname.endsWith("/rpc/reorder_business_products_atomic"),
    );
    assert.ok(rpcCall);
    const body = JSON.parse(String(rpcCall.init.body));
    assert.deepEqual(body, { p_business_id: businessId, p_items: validItems });
    assert.equal(String(rpcCall.init.body).includes("name"), false);
    assert.equal(String(rpcCall.init.body).includes("price"), false);
    assert.equal(new Headers(rpcCall.init.headers).get("Authorization"), "Bearer service-role-key");
  });
});

test("stale any item maps the whole reorder to conflict without retry", async () => {
  await withScenario(
    { rpcStatus: 400, rpcBody: { message: "PRODUCT_CONFLICT", details: "secret" } },
    async (calls) => {
      const response = await POST(request());
      assert.equal(response.status, 409);
      assert.equal((await code(response)).code, "PRODUCT_CONFLICT");
      assert.equal(calls.filter(({ url }) => url.pathname.includes("/rpc/")).length, 1);
    },
  );
});

test("RPC ownership miss maps to controlled not found", async () => {
  await withScenario(
    { rpcStatus: 400, rpcBody: { message: "PRODUCT_NOT_FOUND" } },
    async () => {
      const response = await POST(request());
      assert.equal(response.status, 404);
      assert.equal((await code(response)).code, "PRODUCT_NOT_FOUND");
    },
  );
});

for (const rpcBody of [
  [{ id: productA }],
  [productRow(productA, 2, expectedA)],
  { message: "raw PostgREST secret" },
]) {
  test("malformed authoritative reorder result is controlled unavailable", async () => {
    await withScenario({ rpcBody }, async () => {
      const response = await POST(request());
      const text = await response.text();
      assert.equal(response.status, 503);
      assert.deepEqual(JSON.parse(text), { code: "PRODUCT_UNAVAILABLE" });
      assert.doesNotMatch(text, /PostgREST|secret/i);
    });
  });
}

test("authoritative reorder products are returned with private no-store", async () => {
  await withScenario({}, async () => {
    const response = await POST(request());
    const body = await code(response);
    assert.equal(response.status, 200);
    assert.equal(body.products?.length, 2);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  });
});
