import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POST,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./route.ts";
import {
  PUBLIC_ORDER_BODY_LIMIT_BYTES,
  createPublicOrderIpFingerprint,
  getTrustedVercelClientIp,
  normalizeRateLimitBusinessSlug,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./security.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const rawIp = "203.0.113.10";
const validPayload = {
  businessSlug: "pilot-kebap",
  orderType: "pickup",
  paymentMethod: "cash",
  customer: {
    fullName: "Gizli Müşteri",
    phone: "+90 555 000 00 00",
    address: null,
    note: "Gizli sipariş notu",
  },
  items: [{ productId, quantity: 2 }],
  idempotencyKey,
};

type RateLimitRow = {
  allowed: boolean;
  blocked_dimension: "ip" | "business" | null;
  retry_after_seconds: number;
};

type FetchCall = { url: URL; init: RequestInit; body: Record<string, unknown> };

function allowedRateLimit(): RateLimitRow {
  return {
    allowed: true,
    blocked_dimension: null,
    retry_after_seconds: 0,
  };
}

function createRequest(options: {
  payload?: unknown;
  body?: string;
  trustedIp?: string | null;
  forwardedFor?: string;
  realIp?: string;
  contentLength?: string;
} = {}) {
  const body = options.body ?? JSON.stringify(options.payload ?? validPayload);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.trustedIp !== null) {
    headers.set("x-vercel-forwarded-for", options.trustedIp ?? rawIp);
  }
  if (options.forwardedFor) headers.set("x-forwarded-for", options.forwardedFor);
  if (options.realIp) headers.set("x-real-ip", options.realIp);
  if (options.contentLength) headers.set("content-length", options.contentLength);
  return new Request("https://orders.example.test/api/public/orders", {
    method: "POST",
    headers,
    body,
  });
}

function createScenarioFetch(
  rateLimit: RateLimitRow | ((call: FetchCall, index: number) => RateLimitRow) =
    allowedRateLimit(),
  rateStatus = 200,
) {
  const calls: FetchCall[] = [];
  let rateCallIndex = 0;
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const call = { url, init, body };
    calls.push(call);

    if (url.pathname.endsWith("/rpc/check_public_order_rate_limit")) {
      const row =
        typeof rateLimit === "function"
          ? rateLimit(call, rateCallIndex++)
          : rateLimit;
      return Response.json(rateStatus === 200 ? [row] : { message: "private store detail" }, {
        status: rateStatus,
      });
    }
    if (url.pathname.endsWith("/rpc/create_order_with_items")) {
      return Response.json([
        { order_number: 42, total_amount: 125, order_type: "pickup" },
      ]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { calls, fetchMock };
}

async function withScenario(
  options: {
    rateLimit?: RateLimitRow | ((call: FetchCall, index: number) => RateLimitRow);
    rateStatus?: number;
  },
  run: (context: { calls: FetchCall[]; logs: string[] }) => Promise<void>,
) {
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  const { calls, fetchMock } = createScenarioFetch(
    options.rateLimit,
    options.rateStatus,
  );
  const logs: string[] = [];
  globalThis.fetch = fetchMock;
  console.warn = (...values: unknown[]) => logs.push(values.map(String).join(" "));
  try {
    await run({ calls, logs });
  } finally {
    globalThis.fetch = previousFetch;
    console.warn = previousWarn;
  }
}

function orderRpcCalls(calls: FetchCall[]) {
  return calls.filter(({ url }) =>
    url.pathname.endsWith("/rpc/create_order_with_items"),
  );
}

function rateRpcCalls(calls: FetchCall[]) {
  return calls.filter(({ url }) =>
    url.pathname.endsWith("/rpc/check_public_order_rate_limit"),
  );
}

test("normal public order below limits preserves the authoritative RPC flow", async () => {
  await withScenario({}, async ({ calls, logs }) => {
    const response = await POST(createRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      orderNumber: 42,
      totalAmount: 125,
      orderType: "pickup",
    });
    assert.equal(rateRpcCalls(calls).length, 1);
    assert.equal(orderRpcCalls(calls).length, 1);
    assert.deepEqual(orderRpcCalls(calls)[0].body, {
      p_business_slug: validPayload.businessSlug,
      p_order_type: validPayload.orderType,
      p_customer_name: validPayload.customer.fullName,
      p_customer_phone: validPayload.customer.phone,
      p_customer_address: null,
      p_customer_note: validPayload.customer.note,
      p_items: [{ product_id: productId, quantity: 2 }],
      p_idempotency_key: idempotencyKey,
      p_payment_method: validPayload.paymentMethod,
    });
    assert.deepEqual(logs, []);
  });
});

for (const [dimension, retryAfterSeconds] of [
  ["ip", 12],
  ["business", 3],
] as const) {
  test(`${dimension} burst limit returns deterministic 429 without creating an order`, async () => {
    await withScenario(
      {
        rateLimit: {
          allowed: false,
          blocked_dimension: dimension,
          retry_after_seconds: retryAfterSeconds,
        },
      },
      async ({ calls, logs }) => {
        const response = await POST(createRequest());
        const body = await response.json();
        assert.equal(response.status, 429);
        assert.equal(body.code, "ORDER_RATE_LIMITED");
        assert.equal(response.headers.get("retry-after"), String(retryAfterSeconds));
        assert.equal(orderRpcCalls(calls).length, 0);
        const event = JSON.parse(logs[0]);
        assert.equal(event.event, "public_order_rate_limit_blocked");
        assert.equal(event.limiterDimension, dimension);
      },
    );
  });
}

test("different trusted IPs receive different privacy fingerprints", async () => {
  await withScenario({}, async ({ calls }) => {
    await POST(createRequest({ trustedIp: "203.0.113.10" }));
    await POST(createRequest({ trustedIp: "203.0.113.11" }));
    const rateCalls = rateRpcCalls(calls);
    assert.equal(rateCalls.length, 2);
    assert.notEqual(
      rateCalls[0].body.p_ip_fingerprint,
      rateCalls[1].body.p_ip_fingerprint,
    );
  });
});

test("business limit aggregates the normalized slug across different IPs", async () => {
  let attempts = 0;
  await withScenario(
    {
      rateLimit: (call) => {
        assert.equal(call.body.p_business_slug, "pilot-kebap");
        attempts += 1;
        return attempts === 1
          ? allowedRateLimit()
          : {
              allowed: false,
              blocked_dimension: "business",
              retry_after_seconds: 4,
            };
      },
    },
    async ({ calls }) => {
      assert.equal(
        (await POST(createRequest({ trustedIp: "203.0.113.20" }))).status,
        200,
      );
      const blocked = await POST(createRequest({
        trustedIp: "203.0.113.21",
        payload: { ...validPayload, businessSlug: "PİLOT KEBAP" },
      }));
      assert.equal(blocked.status, 429);
      assert.equal(orderRpcCalls(calls).length, 1);
    },
  );
});

test("Content-Length over the cap returns 413 before reading or calling storage", async () => {
  await withScenario({}, async ({ calls, logs }) => {
    const response = await POST(
      createRequest({
        body: "{}",
        contentLength: String(PUBLIC_ORDER_BODY_LIMIT_BYTES + 1),
      }),
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "ORDER_PAYLOAD_TOO_LARGE");
    assert.equal(calls.length, 0);
    assert.equal(JSON.parse(logs[0]).event, "public_order_payload_too_large");
  });
});

test("missing Content-Length oversized chunked-style body returns 413", async () => {
  await withScenario({}, async ({ calls }) => {
    const response = await POST(
      createRequest({
        body: JSON.stringify({ padding: "x".repeat(PUBLIC_ORDER_BODY_LIMIT_BYTES) }),
      }),
    );
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, "ORDER_PAYLOAD_TOO_LARGE");
    assert.equal(calls.length, 0);
  });
});

test("malformed JSON remains a controlled validation response", async () => {
  await withScenario({}, async ({ calls }) => {
    const response = await POST(createRequest({ body: "{not-json" }));
    assert.equal(response.status, 400);
    assert.equal(calls.length, 0);
    assert.match(await response.text(), /Gecersiz istek govdesi/);
  });
});

test("rate store failure fails closed with controlled 503 and no order RPC", async () => {
  await withScenario({ rateStatus: 500 }, async ({ calls, logs }) => {
    const response = await POST(createRequest());
    const text = await response.text();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "30");
    assert.equal(JSON.parse(text).code, "ORDER_RATE_LIMIT_UNAVAILABLE");
    assert.doesNotMatch(text, /private store detail/i);
    assert.equal(orderRpcCalls(calls).length, 0);
    assert.equal(JSON.parse(logs[0]).event, "public_order_rate_limit_unavailable");
  });
});

test("blocked telemetry excludes customer PII, raw IP, body and idempotency key", async () => {
  await withScenario(
    {
      rateLimit: {
        allowed: false,
        blocked_dimension: "ip",
        retry_after_seconds: 12,
      },
    },
    async ({ logs }) => {
      await POST(createRequest());
      const telemetry = logs.join("\n");
      for (const forbidden of [
        validPayload.customer.fullName,
        validPayload.customer.phone,
        validPayload.customer.note,
        idempotencyKey,
        rawIp,
      ]) {
        assert.equal(telemetry.includes(forbidden), false);
      }
      const event = JSON.parse(logs[0]);
      assert.match(event.ipFingerprint, /^[0-9a-f]{12}$/);
    },
  );
});

test("untrusted forwarded headers cannot override the Vercel client IP", async () => {
  await withScenario({}, async ({ calls }) => {
    await POST(
      createRequest({
        trustedIp: rawIp,
        forwardedFor: "198.51.100.1",
        realIp: "198.51.100.2",
      }),
    );
    await POST(
      createRequest({
        trustedIp: rawIp,
        forwardedFor: "192.0.2.1",
        realIp: "192.0.2.2",
      }),
    );
    const rateCalls = rateRpcCalls(calls);
    assert.equal(
      rateCalls[0].body.p_ip_fingerprint,
      rateCalls[1].body.p_ip_fingerprint,
    );
  });
});

test("missing trusted metadata uses one fail-safe bucket instead of spoofable headers", () => {
  const first = createRequest({
    trustedIp: null,
    forwardedFor: "198.51.100.10",
    realIp: "198.51.100.11",
  });
  const second = createRequest({
    trustedIp: null,
    forwardedFor: "192.0.2.10",
    realIp: "192.0.2.11",
  });
  assert.equal(getTrustedVercelClientIp(first), null);
  assert.equal(getTrustedVercelClientIp(second), null);
  assert.equal(
    createPublicOrderIpFingerprint(null, "service-role-key"),
    createPublicOrderIpFingerprint(null, "service-role-key"),
  );
});

test("equivalent IPv6 forms and slug variants normalize to the same buckets", () => {
  const expanded = createRequest({ trustedIp: "2001:0db8:0:0:0:0:0:1" });
  const compressed = createRequest({ trustedIp: "2001:db8::1" });
  assert.equal(
    getTrustedVercelClientIp(expanded),
    getTrustedVercelClientIp(compressed),
  );
  assert.equal(normalizeRateLimitBusinessSlug(" PİLOT KEBAP "), "pilot-kebap");
  assert.equal(normalizeRateLimitBusinessSlug("pilot-kebap"), "pilot-kebap");
});

test("same idempotency key retries remain unchanged and cannot bypass limiting", async () => {
  await withScenario({}, async ({ calls }) => {
    await POST(createRequest());
    await POST(createRequest());
    assert.equal(rateRpcCalls(calls).length, 2);
    assert.equal(orderRpcCalls(calls).length, 2);
    assert.equal(orderRpcCalls(calls)[0].body.p_idempotency_key, idempotencyKey);
    assert.equal(orderRpcCalls(calls)[1].body.p_idempotency_key, idempotencyKey);
  });
});
