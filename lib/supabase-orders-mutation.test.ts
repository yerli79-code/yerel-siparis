import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BusinessOrderMutationError,
  businessOrderMutationTimeoutMs,
  fetchBusinessOrdersPage,
  updateBusinessOrderStatus,
  type BusinessOrder,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./supabase-orders.ts";

const orderId = "11111111-1111-4111-8111-111111111111";
const currentUpdatedAt = "2026-08-26T09:00:00.000Z";
const nextUpdatedAt = "2026-08-26T09:00:01.000Z";

function order(overrides: Partial<BusinessOrder> = {}): BusinessOrder {
  return {
    id: orderId,
    orderNumber: 17,
    status: "preparing",
    orderType: "delivery",
    paymentMethod: "cash",
    customerName: "Test Müşteri",
    customerPhone: "05550000000",
    customerAddress: "Test adresi",
    customerNote: null,
    totalAmount: 250,
    currency: "TRY",
    createdAt: "2026-08-26T08:55:00.000Z",
    updatedAt: nextUpdatedAt,
    items: [],
    ...overrides,
  };
}

async function withFetchMock(
  fetchMock: typeof fetch,
  run: () => Promise<void>,
) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("PATCH sends exactly status and expectedUpdatedAt", async () => {
  const captures: Array<{ input: string; init?: RequestInit }> = [];
  await withFetchMock(async (input, init) => {
    captures.push({ input: String(input), init });
    return Response.json({ order: order() });
  }, async () => {
    const result = await updateBusinessOrderStatus(
      orderId,
      "preparing",
      currentUpdatedAt,
      "access-token",
    );
    assert.equal(result.updatedAt, nextUpdatedAt);
  });

  const captured = captures[0];
  assert.ok(captured);
  assert.equal(captured.input, `/api/business/orders/${orderId}`);
  const body = JSON.parse(String(captured.init?.body));
  assert.deepEqual(body, {
    status: "preparing",
    expectedUpdatedAt: currentUpdatedAt,
  });
  assert.deepEqual(Object.keys(body).sort(), ["expectedUpdatedAt", "status"]);
  for (const forbidden of [
    "businessId",
    "ownerId",
    "userId",
    "customerName",
    "customerPhone",
    "items",
    "order",
  ]) {
    assert.equal(forbidden in body, false);
  }
});

test("authoritative returned updatedAt can be used as the next mutation version", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const responses = [
    order({ updatedAt: nextUpdatedAt }),
    order({ status: "ready", updatedAt: "2026-08-26T09:00:02.000Z" }),
  ];

  await withFetchMock(async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ order: responses.shift() });
  }, async () => {
    const first = await updateBusinessOrderStatus(
      orderId,
      "preparing",
      currentUpdatedAt,
      "access-token",
    );
    await updateBusinessOrderStatus(
      orderId,
      "ready",
      first.updatedAt,
      "access-token",
    );
  });

  assert.equal(bodies[1].expectedUpdatedAt, nextUpdatedAt);
});

for (const [status, code] of [
  [409, "ORDER_CONFLICT"],
  [404, "ORDER_NOT_FOUND"],
  [403, "ORDER_FORBIDDEN"],
  [401, "ORDER_UNAUTHORIZED"],
  [400, "INVALID_ORDER_MUTATION"],
  [503, "ORDER_UNAVAILABLE"],
] as const) {
  test(`HTTP ${status} maps to safe ${code}`, async () => {
    await withFetchMock(
      async () =>
        new Response('{"message":"raw server detail","code":"UNTRUSTED"}', {
          status,
        }),
      async () => {
        await assert.rejects(
          () =>
            updateBusinessOrderStatus(
              orderId,
              "preparing",
              currentUpdatedAt,
              "access-token",
            ),
          (error: unknown) =>
            error instanceof BusinessOrderMutationError &&
            error.code === code &&
            error.status === status &&
            !error.message.includes("raw server detail"),
        );
      },
    );
  });
}

test("network failure becomes controlled ORDER_UNAVAILABLE", async () => {
  await withFetchMock(async () => {
    throw new Error("network secret");
  }, async () => {
    await assert.rejects(
      () =>
        updateBusinessOrderStatus(
          orderId,
          "preparing",
          currentUpdatedAt,
          "access-token",
        ),
      (error: unknown) =>
        error instanceof BusinessOrderMutationError &&
        error.code === "ORDER_UNAVAILABLE" &&
        error.status === null,
    );
  });
});

test("malformed success response becomes controlled ORDER_UNAVAILABLE", async () => {
  await withFetchMock(async () => new Response("not-json", { status: 200 }), async () => {
    await assert.rejects(
      () =>
        updateBusinessOrderStatus(
          orderId,
          "preparing",
          currentUpdatedAt,
          "access-token",
        ),
      (error: unknown) =>
        error instanceof BusinessOrderMutationError &&
        error.code === "ORDER_UNAVAILABLE",
    );
  });
});

test("malformed authoritative order response is rejected", async () => {
  await withFetchMock(async () => Response.json({ order: { id: orderId } }), async () => {
    await assert.rejects(
      () =>
        updateBusinessOrderStatus(
          orderId,
          "preparing",
          currentUpdatedAt,
          "access-token",
        ),
      (error: unknown) =>
        error instanceof BusinessOrderMutationError &&
        error.code === "ORDER_UNAVAILABLE",
    );
  });
});

test("mutation timeout aborts and becomes controlled ORDER_UNAVAILABLE", async () => {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((callback: TimerHandler) => {
    queueMicrotask(() => {
      if (typeof callback === "function") callback();
    });
    return 1;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;

  try {
    await withFetchMock((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }, async () => {
      await assert.rejects(
        () =>
          updateBusinessOrderStatus(
            orderId,
            "preparing",
            currentUpdatedAt,
            "access-token",
          ),
        (error: unknown) =>
          error instanceof BusinessOrderMutationError &&
          error.code === "ORDER_UNAVAILABLE",
      );
    });
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }

  assert.equal(businessOrderMutationTimeoutMs, 20_000);
});

test("superseded list AbortError remains distinguishable and is not wrapped", async () => {
  await withFetchMock(async () => {
    throw new DOMException("superseded", "AbortError");
  }, async () => {
    await assert.rejects(
      () =>
        fetchBusinessOrdersPage(
          "access-token",
          { page: 1, pageSize: 20 },
          { signal: new AbortController().signal },
        ),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
  });
});
