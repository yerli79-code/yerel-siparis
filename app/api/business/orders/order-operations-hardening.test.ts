import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PATCH,
  isValidOrderMutationTimestamp,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./[orderId]/route.ts";

const orderId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const otherBusinessId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const expectedUpdatedAt = "2026-08-26T09:00:00.000Z";
const nextUpdatedAt = "2026-08-26T09:00:01.000Z";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

type Scenario = {
  authValid?: boolean;
  businessOperational?: boolean;
  orderBusinessId?: string;
  orderExists?: boolean;
  orderStatus?: "new" | "preparing" | "ready" | "delivered" | "cancelled";
  orderUpdatedAt?: string;
  patchBody?: unknown;
  patchStatus?: number;
  patchThrows?: boolean;
};

type FetchCall = { url: URL; init: RequestInit };

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId,
    order_number: 91,
    business_order_number: 17,
    business_id: businessId,
    status: "new",
    order_type: "delivery",
    payment_method: "cash",
    customer_name: "Test Müşteri",
    customer_phone: "05550000000",
    customer_address: "Test adresi",
    customer_note: null,
    total_amount: 250,
    currency: "TRY",
    created_at: "2026-08-26T08:55:00.000Z",
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
        ? Response.json({}, { status: 401 })
        : Response.json({ id: userId });
    }

    if (url.pathname === "/rest/v1/businesses") {
      return Response.json([
        {
          id: businessId,
          owner_id: userId,
          is_active: scenario.businessOperational !== false,
          subscription_status:
            scenario.businessOperational === false ? "blocked" : "active",
          subscription_expires_at: "2099-01-01T00:00:00.000Z",
        },
      ]);
    }

    if (url.pathname === "/rest/v1/orders" && init.method !== "PATCH") {
      if (scenario.orderExists === false) return Response.json([]);
      return Response.json([
        orderRow({
          business_id: scenario.orderBusinessId ?? businessId,
          status: scenario.orderStatus ?? "new",
          updated_at: scenario.orderUpdatedAt ?? expectedUpdatedAt,
        }),
      ]);
    }

    if (url.pathname === "/rest/v1/orders" && init.method === "PATCH") {
      if (scenario.patchThrows) throw new Error("secret transport detail");
      const body =
        scenario.patchBody === undefined
          ? [
              orderRow({
                status: "preparing",
                updated_at: nextUpdatedAt,
              }),
            ]
          : scenario.patchBody;
      return Response.json(body, { status: scenario.patchStatus ?? 200 });
    }

    if (url.pathname === "/rest/v1/order_items") return Response.json([]);

    throw new Error(`Unexpected fetch: ${url}`);
  };

  return { calls, fetchMock };
}

function mutationRequest(
  body: string = JSON.stringify({ status: "preparing", expectedUpdatedAt }),
  authorization = "Bearer valid-token",
) {
  return new Request(`https://panel.example.test/api/business/orders/${orderId}`, {
    method: "PATCH",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
}

function context(id = orderId) {
  return { params: Promise.resolve({ orderId: id }) };
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

async function responseCode(response: Response) {
  return (await response.json()) as { code?: string; order?: unknown };
}

test("canonical valid UUID and authoritative RFC3339 timestamps are accepted", () => {
  assert.equal(isValidOrderMutationTimestamp(expectedUpdatedAt), true);
  assert.equal(isValidOrderMutationTimestamp("2026-08-26T12:00:00.123456+03:00"), true);
});

test("invalid UUID is rejected before any server transport", async () => {
  await withScenario({}, async (calls) => {
    const response = await PATCH(mutationRequest(), context("demo-order"));
    assert.equal(response.status, 400);
    assert.equal((await responseCode(response)).code, "INVALID_ORDER_MUTATION");
    assert.equal(calls.length, 0);
  });
});

test("canonical-invalid UUID is rejected", async () => {
  await withScenario({}, async (calls) => {
    const response = await PATCH(
      mutationRequest(),
      context("11111111-1111-1111-1111-111111111111"),
    );
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
  });
});

test("missing auth returns controlled 401", async () => {
  await withScenario({}, async (calls) => {
    const response = await PATCH(mutationRequest(undefined, ""), context());
    assert.equal(response.status, 401);
    assert.equal((await responseCode(response)).code, "ORDER_UNAUTHORIZED");
    assert.equal(calls.length, 0);
  });
});

test("invalid auth returns controlled 401", async () => {
  await withScenario({ authValid: false }, async () => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 401);
    assert.equal((await responseCode(response)).code, "ORDER_UNAUTHORIZED");
  });
});

test("order owned by another business is hidden as 404", async () => {
  await withScenario({ orderBusinessId: otherBusinessId }, async (calls) => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 404);
    assert.equal((await responseCode(response)).code, "ORDER_NOT_FOUND");
    assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
  });
});

test("missing order is controlled 404", async () => {
  await withScenario({ orderExists: false }, async () => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 404);
    assert.equal((await responseCode(response)).code, "ORDER_NOT_FOUND");
  });
});

test("non-operational business is controlled 403", async () => {
  await withScenario({ businessOperational: false }, async (calls) => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 403);
    assert.equal((await responseCode(response)).code, "ORDER_FORBIDDEN");
    assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
  });
});

for (const [name, body] of [
  ["malformed JSON", "{"],
  ["unknown body field", JSON.stringify({ status: "preparing", expectedUpdatedAt, businessId })],
  ["missing expectedUpdatedAt", JSON.stringify({ status: "preparing" })],
  ["null expectedUpdatedAt", JSON.stringify({ status: "preparing", expectedUpdatedAt: null })],
  ["array body", JSON.stringify([{ status: "preparing", expectedUpdatedAt }])],
  ["invalid timestamp", JSON.stringify({ status: "preparing", expectedUpdatedAt: "2026-02-30T09:00:00Z" })],
  ["invalid status", JSON.stringify({ status: "accepted", expectedUpdatedAt })],
] as const) {
  test(`${name} returns controlled 400`, async () => {
    await withScenario({}, async (calls) => {
      const response = await PATCH(mutationRequest(body), context());
      assert.equal(response.status, 400);
      assert.equal((await responseCode(response)).code, "INVALID_ORDER_MUTATION");
      assert.equal(calls.length, 0);
    });
  });
}

test("matching version returns the authoritative updated order", async () => {
  await withScenario({}, async () => {
    const response = await PATCH(mutationRequest(), context());
    const body = await responseCode(response);
    assert.equal(response.status, 200);
    assert.equal((body.order as { status: string }).status, "preparing");
    assert.equal((body.order as { updatedAt: string }).updatedAt, nextUpdatedAt);
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  });
});

test("stale expectedUpdatedAt returns 409 without mutation", async () => {
  await withScenario({ orderUpdatedAt: nextUpdatedAt }, async (calls) => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 409);
    assert.equal((await responseCode(response)).code, "ORDER_CONFLICT");
    assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
  });
});

test("conditional PATCH zero rows is a conflict and is not retried", async () => {
  await withScenario({ patchBody: [] }, async (calls) => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 409);
    assert.equal((await responseCode(response)).code, "ORDER_CONFLICT");
    assert.equal(calls.filter(({ init }) => init.method === "PATCH").length, 1);
  });
});

test("same-status request is idempotent and does not PATCH", async () => {
  await withScenario({ orderStatus: "preparing" }, async (calls) => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 200);
    assert.equal(calls.some(({ init }) => init.method === "PATCH"), false);
  });
});

for (const [name, scenario] of [
  ["malformed mutation result", { patchBody: { id: orderId } }],
  ["missing authoritative row fields", { patchBody: [{ id: orderId }] }],
  ["database HTTP failure", { patchBody: { message: "raw database secret" }, patchStatus: 500 }],
  ["transport failure", { patchThrows: true }],
] as const) {
  test(`${name} becomes controlled 503 without raw leakage`, async () => {
    await withScenario(scenario, async () => {
      const response = await PATCH(mutationRequest(), context());
      const text = await response.text();
      assert.equal(response.status, 503);
      assert.deepEqual(JSON.parse(text), { code: "ORDER_UNAVAILABLE" });
      assert.doesNotMatch(text, /secret|database|PostgREST/i);
    });
  });
}

test("conditional mutation targets only order, business, and expected updated_at", async () => {
  await withScenario({}, async (calls) => {
    await PATCH(mutationRequest(), context());
    const patchCall = calls.find(({ init }) => init.method === "PATCH");
    assert.ok(patchCall);
    assert.equal(patchCall.url.searchParams.get("id"), `eq.${orderId}`);
    assert.equal(patchCall.url.searchParams.get("business_id"), `eq.${businessId}`);
    assert.equal(
      patchCall.url.searchParams.get("updated_at"),
      `eq.${expectedUpdatedAt}`,
    );
    assert.equal(patchCall.init.headers && new Headers(patchCall.init.headers).get("Prefer"), "return=representation");
    assert.deepEqual(JSON.parse(String(patchCall.init.body)), { status: "preparing" });
  });
});

test("successful conditional PATCH does not perform a second order GET", async () => {
  await withScenario({}, async (calls) => {
    const response = await PATCH(mutationRequest(), context());
    assert.equal(response.status, 200);
    const orderGets = calls.filter(
      ({ url, init }) =>
        url.pathname === "/rest/v1/orders" && init.method !== "PATCH",
    );
    assert.equal(orderGets.length, 1);
  });
});
