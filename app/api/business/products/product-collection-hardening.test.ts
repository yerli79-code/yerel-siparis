import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET,
  POST,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./route.ts";

const productId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const updatedAt = "2026-08-29T06:00:00.000Z";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    business_id: businessId,
    client_product_id: "client-product",
    name: "Yeni Ürün",
    price: 75,
    description: "",
    category: "Genel",
    image_label: "",
    image_url: null,
    is_active: true,
    sort_order: 4,
    created_at: "2026-08-29T05:00:00.000Z",
    updated_at: updatedAt,
    ...overrides,
  };
}

type Scenario = {
  authValid?: boolean;
  businessActive?: boolean;
  listBody?: unknown;
  insertBody?: unknown;
  insertStatus?: number;
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
          subscription_status: "active",
          subscription_expires_at: "2099-12-31T00:00:00.000Z",
        },
      ]);
    }
    if (url.pathname === "/rest/v1/products" && init.method === "POST") {
      return Response.json(scenario.insertBody ?? [productRow()], {
        status: scenario.insertStatus ?? 201,
      });
    }
    if (url.pathname === "/rest/v1/products") {
      if (url.searchParams.get("select") === "sort_order") {
        return Response.json([{ sort_order: 3 }]);
      }
      return Response.json(scenario.listBody ?? [productRow()]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { calls, fetchMock };
}

function getRequest(authorization = "Bearer token") {
  return new Request("https://panel.example.test/api/business/products", {
    headers: { Authorization: authorization },
  });
}

function postRequest(
  body = JSON.stringify({
    input: { name: "Yeni Ürün", price: 75, category: "Genel" },
  }),
  authorization = "Bearer token",
) {
  return new Request("https://panel.example.test/api/business/products", {
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

test("authenticated product GET is private no-store and authoritative", async () => {
  await withScenario({}, async () => {
    const response = await GET(getRequest());
    const body = (await response.json()) as { products: unknown[] };
    assert.equal(response.status, 200);
    assert.equal(body.products.length, 1);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("vary"), "Authorization");
  });
});

test("product GET missing or invalid auth is controlled", async () => {
  await withScenario({}, async () => {
    const response = await GET(getRequest(""));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { code: "PRODUCT_UNAUTHORIZED" });
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("vary"), "Authorization");
  });
  await withScenario({ authValid: false }, async () => {
    const response = await GET(getRequest());
    assert.equal(response.status, 401);
  });
});

test("malformed product GET database payload is controlled unavailable", async () => {
  await withScenario({ listBody: [{ id: productId, raw: "secret" }] }, async () => {
    const response = await GET(getRequest());
    const text = await response.text();
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(text), { code: "PRODUCT_UNAVAILABLE" });
    assert.doesNotMatch(text, /secret|raw/i);
  });
});

for (const [name, body] of [
  ["malformed JSON", "{"],
  ["unknown root", JSON.stringify({ input: { name: "X", price: 1, category: "Genel" }, businessId })],
  ["browser clientProductId", JSON.stringify({ input: { name: "X", price: 1, category: "Genel", clientProductId: "spoof" } })],
  ["empty name", JSON.stringify({ input: { name: "", price: 1, category: "Genel" } })],
  ["negative price", JSON.stringify({ input: { name: "X", price: -1, category: "Genel" } })],
  ["legacy new category", JSON.stringify({ input: { name: "X", price: 1, category: "Eski" } })],
  ["negative sort", JSON.stringify({ input: { name: "X", price: 1, category: "Genel", sortOrder: -1 } })],
] as const) {
  test(`create ${name} is controlled invalid`, async () => {
    await withScenario({}, async () => {
      const response = await POST(postRequest(body));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { code: "INVALID_PRODUCT_MUTATION" });
    });
  });
}

test("create derives ownership, client ID and default order on the server", async () => {
  await withScenario({}, async (calls) => {
    const response = await POST(postRequest());
    const body = (await response.json()) as { product: Record<string, unknown> };
    assert.equal(response.status, 200);
    assert.equal(body.product.id, productId);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const insert = calls.find(({ init }) => init.method === "POST");
    assert.ok(insert);
    const payload = JSON.parse(String(insert.init.body));
    assert.equal(payload.business_id, businessId);
    assert.match(payload.client_product_id, /^[0-9a-f-]{36}$/i);
    assert.equal(payload.sort_order, 4);
    assert.equal("owner_id" in payload, false);
    assert.equal("updated_at" in payload, false);
  });
});

test("inactive business cannot create products", async () => {
  await withScenario({ businessActive: false }, async (calls) => {
    const response = await POST(postRequest());
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { code: "PRODUCT_FORBIDDEN" });
    assert.equal(calls.some(({ init }) => init.method === "POST"), false);
  });
});

test("malformed create result is unavailable without raw leakage", async () => {
  await withScenario(
    { insertBody: { message: "raw database secret" }, insertStatus: 500 },
    async () => {
      const response = await POST(postRequest());
      const text = await response.text();
      assert.equal(response.status, 503);
      assert.deepEqual(JSON.parse(text), { code: "PRODUCT_UNAVAILABLE" });
      assert.doesNotMatch(text, /secret|database/i);
    },
  );
});
