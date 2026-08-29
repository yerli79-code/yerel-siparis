import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELETE,
  PATCH,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./[productId]/route.ts";
import {
  isValidProductMutationTimestamp,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./_utils.ts";

const productId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const otherBusinessId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const expectedUpdatedAt = "2026-08-29T06:00:00.000Z";
const nextUpdatedAt = "2026-08-29T06:00:01.000Z";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

type FetchCall = { url: URL; init: RequestInit };
type Scenario = {
  authValid?: boolean;
  productExists?: boolean;
  productBusinessId?: string;
  productUpdatedAt?: string;
  productName?: string;
  businessOwnerId?: string;
  businessActive?: boolean;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: string | null;
  patchBody?: unknown;
  patchStatus?: number;
  patchThrows?: boolean;
  deleteBody?: unknown;
  deleteStatus?: number;
};

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: productId,
    business_id: businessId,
    client_product_id: "client-product-1",
    name: "Test Ürün",
    price: 125,
    description: "Açıklama",
    category: "Genel",
    image_label: "",
    image_url: null,
    is_active: true,
    sort_order: 1,
    created_at: "2026-08-29T05:00:00.000Z",
    updated_at: expectedUpdatedAt,
    ...overrides,
  };
}

function createScenarioFetch(scenario: Scenario = {}) {
  const calls: FetchCall[] = [];
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });

    if (url.pathname === "/auth/v1/user") {
      return scenario.authValid === false
        ? Response.json({ message: "invalid secret" }, { status: 401 })
        : Response.json({ id: userId });
    }

    if (url.pathname === "/rest/v1/products" && !init.method) {
      if (scenario.productExists === false) return Response.json([]);
      return Response.json([
        productRow({
          business_id: scenario.productBusinessId ?? businessId,
          updated_at: scenario.productUpdatedAt ?? expectedUpdatedAt,
          name: scenario.productName ?? "Test Ürün",
        }),
      ]);
    }

    if (url.pathname === "/rest/v1/businesses") {
      return Response.json([
        {
          id: scenario.productBusinessId ?? businessId,
          owner_id: scenario.businessOwnerId ?? userId,
          is_active: scenario.businessActive ?? true,
          subscription_status: scenario.subscriptionStatus ?? "active",
          subscription_expires_at:
            scenario.subscriptionExpiresAt === undefined
              ? "2099-12-31T00:00:00.000Z"
              : scenario.subscriptionExpiresAt,
        },
      ]);
    }

    if (url.pathname === "/rest/v1/products" && init.method === "PATCH") {
      if (scenario.patchThrows) throw new Error("raw transport secret");
      const body =
        scenario.patchBody === undefined
          ? [productRow({ name: "Yeni Ad", updated_at: nextUpdatedAt })]
          : scenario.patchBody;
      return Response.json(body, { status: scenario.patchStatus ?? 200 });
    }

    if (url.pathname === "/rest/v1/products" && init.method === "DELETE") {
      return Response.json(
        scenario.deleteBody === undefined ? [productRow()] : scenario.deleteBody,
        { status: scenario.deleteStatus ?? 200 },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { calls, fetchMock };
}

function patchRequest(
  body = JSON.stringify({
    input: { name: "Yeni Ad" },
    expectedUpdatedAt,
  }),
  authorization = "Bearer valid-token",
) {
  return new Request(`https://panel.example.test/api/business/products/${productId}`, {
    method: "PATCH",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
  });
}

function deleteRequest(
  body = JSON.stringify({ expectedUpdatedAt }),
  authorization = "Bearer valid-token",
) {
  return new Request(`https://panel.example.test/api/business/products/${productId}`, {
    method: "DELETE",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body,
  });
}

function context(id = productId) {
  return { params: Promise.resolve({ productId: id }) };
}

async function withScenario(
  scenario: Scenario,
  run: (calls: FetchCall[]) => Promise<void>,
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

async function responseBody(response: Response) {
  return (await response.json()) as { code?: string; product?: Record<string, unknown> };
}

test("canonical product UUID and authoritative timestamps are accepted", () => {
  assert.equal(isValidProductMutationTimestamp(expectedUpdatedAt), true);
  assert.equal(
    isValidProductMutationTimestamp("2026-08-29T09:00:00.123456+03:00"),
    true,
  );
});

for (const invalidId of ["demo-product", "11111111-1111-1111-1111-111111111111"]) {
  test(`malformed or non-canonical product UUID ${invalidId} is rejected`, async () => {
    await withScenario({}, async (calls) => {
      const response = await PATCH(patchRequest(), context(invalidId));
      assert.equal(response.status, 400);
      assert.equal((await responseBody(response)).code, "INVALID_PRODUCT_MUTATION");
      assert.equal(calls.length, 0);
    });
  });
}

test("missing and invalid auth return controlled 401", async () => {
  await withScenario({}, async () => {
    const missing = await PATCH(patchRequest(undefined, ""), context());
    assert.equal(missing.status, 401);
    assert.equal((await responseBody(missing)).code, "PRODUCT_UNAUTHORIZED");
  });
  await withScenario({ authValid: false }, async () => {
    const invalid = await PATCH(patchRequest(), context());
    assert.equal(invalid.status, 401);
    assert.equal((await responseBody(invalid)).code, "PRODUCT_UNAUTHORIZED");
  });
});

test("other-business and missing products are hidden as 404", async () => {
  for (const scenario of [
    { productExists: false },
    { productBusinessId: otherBusinessId, businessOwnerId: "55555555-5555-4555-8555-555555555555" },
  ]) {
    await withScenario(scenario, async (calls) => {
      const response = await PATCH(patchRequest(), context());
      assert.equal(response.status, 404);
      assert.equal((await responseBody(response)).code, "PRODUCT_NOT_FOUND");
      assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
    });
  }
});

for (const scenario of [
  { businessActive: false },
  { subscriptionStatus: "expired" },
  { subscriptionExpiresAt: null },
  { subscriptionExpiresAt: "2020-01-01T00:00:00.000Z" },
]) {
  test(`inactive or expired business is controlled forbidden ${JSON.stringify(scenario)}`, async () => {
    await withScenario(scenario, async (calls) => {
      const response = await PATCH(patchRequest(), context());
      assert.equal(response.status, 403);
      assert.equal((await responseBody(response)).code, "PRODUCT_FORBIDDEN");
      assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
    });
  });
}

for (const [name, body] of [
  ["malformed JSON", "{"],
  ["array root", JSON.stringify([])],
  ["unknown root field", JSON.stringify({ input: { name: "Yeni Ad" }, expectedUpdatedAt, businessId })],
  ["unknown input field", JSON.stringify({ input: { name: "Yeni Ad", ownerId: userId }, expectedUpdatedAt })],
  ["missing expectedUpdatedAt", JSON.stringify({ input: { name: "Yeni Ad" } })],
  ["invalid expectedUpdatedAt", JSON.stringify({ input: { name: "Yeni Ad" }, expectedUpdatedAt: "2026-02-30T00:00:00Z" })],
  ["negative sort order", JSON.stringify({ input: { sortOrder: -1 }, expectedUpdatedAt })],
  ["fractional sort order", JSON.stringify({ input: { sortOrder: 1.5 }, expectedUpdatedAt })],
] as const) {
  test(`${name} returns controlled 400`, async () => {
    await withScenario({}, async () => {
      const response = await PATCH(patchRequest(body), context());
      assert.equal(response.status, 400);
      assert.equal((await responseBody(response)).code, "INVALID_PRODUCT_MUTATION");
    });
  });
}

test("stale expectedUpdatedAt returns conflict without PATCH", async () => {
  await withScenario({ productUpdatedAt: nextUpdatedAt }, async (calls) => {
    const response = await PATCH(patchRequest(), context());
    assert.equal(response.status, 409);
    assert.equal((await responseBody(response)).code, "PRODUCT_CONFLICT");
    assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
  });
});

test("matching version conditionally PATCHes and returns authoritative row", async () => {
  await withScenario({}, async (calls) => {
    const response = await PATCH(patchRequest(), context());
    const body = await responseBody(response);
    assert.equal(response.status, 200);
    assert.equal(body.product?.name, "Yeni Ad");
    assert.equal(body.product?.updated_at, nextUpdatedAt);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    const patchCall = calls.find(({ init }) => init.method === "PATCH");
    assert.ok(patchCall);
    assert.equal(patchCall.url.searchParams.get("id"), `eq.${productId}`);
    assert.equal(patchCall.url.searchParams.get("business_id"), `eq.${businessId}`);
    assert.equal(patchCall.url.searchParams.get("updated_at"), `eq.${expectedUpdatedAt}`);
    assert.equal(new Headers(patchCall.init.headers).get("Prefer"), "return=representation");
    assert.deepEqual(JSON.parse(String(patchCall.init.body)), { name: "Yeni Ad" });
  });
});

test("conditional PATCH zero rows is a conflict with no retry", async () => {
  await withScenario({ patchBody: [] }, async (calls) => {
    const response = await PATCH(patchRequest(), context());
    assert.equal(response.status, 409);
    assert.equal((await responseBody(response)).code, "PRODUCT_CONFLICT");
    assert.equal(calls.filter(({ init }) => init.method === "PATCH").length, 1);
  });
});

test("same-value update is a no-op and preserves updated_at", async () => {
  await withScenario({}, async (calls) => {
    const response = await PATCH(
      patchRequest(JSON.stringify({ input: { name: "Test Ürün" }, expectedUpdatedAt })),
      context(),
    );
    const body = await responseBody(response);
    assert.equal(response.status, 200);
    assert.equal(body.product?.updated_at, expectedUpdatedAt);
    assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
  });
});

for (const [name, scenario] of [
  ["malformed success row", { patchBody: [{ id: productId }] }],
  ["malformed response shape", { patchBody: { id: productId } }],
  ["database error", { patchBody: { message: "raw database secret" }, patchStatus: 500 }],
  ["network failure", { patchThrows: true }],
] as const) {
  test(`${name} becomes controlled unavailable without leakage`, async () => {
    await withScenario(scenario, async () => {
      const response = await PATCH(patchRequest(), context());
      const text = await response.text();
      assert.equal(response.status, 503);
      assert.deepEqual(JSON.parse(text), { code: "PRODUCT_UNAVAILABLE" });
      assert.doesNotMatch(text, /secret|database|PostgREST/i);
    });
  });
}

for (const [name, body] of [
  ["missing expectedUpdatedAt", JSON.stringify({})],
  ["unknown root field", JSON.stringify({ expectedUpdatedAt, businessId })],
  ["malformed timestamp", JSON.stringify({ expectedUpdatedAt: "not-a-date" })],
] as const) {
  test(`DELETE ${name} is controlled 400`, async () => {
    await withScenario({}, async () => {
      const response = await DELETE(deleteRequest(body), context());
      assert.equal(response.status, 400);
      assert.equal((await responseBody(response)).code, "INVALID_PRODUCT_MUTATION");
    });
  });
}

test("stale DELETE conflicts without deleting", async () => {
  await withScenario({ productUpdatedAt: nextUpdatedAt }, async (calls) => {
    const response = await DELETE(deleteRequest(), context());
    assert.equal(response.status, 409);
    assert.equal((await responseBody(response)).code, "PRODUCT_CONFLICT");
    assert.equal(calls.some(({ init }) => init.method === "DELETE"), false);
  });
});

test("successful DELETE is conditional and confirms the authoritative affected row", async () => {
  await withScenario({}, async (calls) => {
    const response = await DELETE(deleteRequest(), context());
    const body = await responseBody(response);
    assert.equal(response.status, 200);
    assert.equal(body.product?.id, productId);
    const deleteCall = calls.find(({ init }) => init.method === "DELETE");
    assert.ok(deleteCall);
    assert.equal(deleteCall.url.searchParams.get("business_id"), `eq.${businessId}`);
    assert.equal(deleteCall.url.searchParams.get("updated_at"), `eq.${expectedUpdatedAt}`);
    assert.equal(new Headers(deleteCall.init.headers).get("Prefer"), "return=representation");
  });
});

test("conditional DELETE zero rows is a conflict", async () => {
  await withScenario({ deleteBody: [] }, async () => {
    const response = await DELETE(deleteRequest(), context());
    assert.equal(response.status, 409);
    assert.equal((await responseBody(response)).code, "PRODUCT_CONFLICT");
  });
});
