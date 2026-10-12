import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getBusinessReportRangeBoundaries,
  getIstanbulCalendarDate,
} from "../../../../lib/business-reports";
import { GET } from "./route";

const supabaseUrl = "https://project.example.supabase.co";
const anonKey = "anon-test-key";
const serviceRoleKey = "service-role-secret-value";
const serverBusinessId = "11111111-1111-4111-8111-111111111111";

type MockOptions = {
  authOk?: boolean;
  businesses?: unknown[];
  rpcStatus?: number;
  rpcBody?: unknown;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyReport(from: string, to: string) {
  const bounds = getBusinessReportRangeBoundaries({ from, to });
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const dayCount = Math.round(
    (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000),
  ) + 1;
  const daily = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(fromDate);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      totalOrders: 0,
      completedOrders: 0,
      completedSales: "0.00",
    };
  });

  return {
    schemaVersion: 1,
    business: { name: "Test Isletmesi" },
    period: {
      from,
      to,
      timezone: "Europe/Istanbul",
      rangeStart: bounds.rangeStart,
      rangeEndExclusive: bounds.rangeEndExclusive,
      generatedAt: "2026-08-11T12:00:00.000Z",
    },
    currency: "TRY",
    kpis: {
      totalOrders: 0,
      completedOrders: 0,
      cancelledOrders: 0,
      completedSales: "0.00",
      averageOrderValue: null,
      soldItemQuantity: 0,
    },
    daily,
    products: [],
    payments: [
      {
        method: "cash",
        label: "Nakit",
        orderCount: 0,
        revenue: "0.00",
        sharePercent: 0,
      },
      {
        method: "card",
        label: "Kart",
        orderCount: 0,
        revenue: "0.00",
        sharePercent: 0,
      },
      {
        method: "unknown",
        label: "Belirtilmemiş",
        orderCount: 0,
        revenue: "0.00",
        sharePercent: 0,
      },
    ],
    orderTypes: [
      {
        type: "delivery",
        label: "Teslimat",
        orderCount: 0,
        revenue: "0.00",
        sharePercent: 0,
      },
      {
        type: "pickup",
        label: "Gel-al",
        orderCount: 0,
        revenue: "0.00",
        sharePercent: 0,
      },
    ],
    statuses: [
      { status: "new", count: 0, sharePercent: 0 },
      { status: "preparing", count: 0, sharePercent: 0 },
      { status: "ready", count: 0, sharePercent: 0 },
      { status: "delivered", count: 0, sharePercent: 0 },
      { status: "cancelled", count: 0, sharePercent: 0 },
    ],
  };
}

async function runRoute(
  query: string,
  options: MockOptions = {},
  authorization = "Bearer valid-user-token",
) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });

    if (url.endsWith("/auth/v1/user")) {
      return options.authOk === false
        ? jsonResponse({ message: "invalid token" }, 401)
        : jsonResponse({ id: "user-1" });
    }
    if (url.includes("/rest/v1/businesses?")) {
      return jsonResponse(
        options.businesses ?? [
          {
            id: serverBusinessId,
            owner_id: "user-1",
            is_active: true,
            subscription_status: "active",
            subscription_expires_at: "2027-01-01T00:00:00.000Z",
          },
        ],
      );
    }
    if (url.endsWith("/rest/v1/rpc/get_business_report")) {
      const params = new URLSearchParams(query);
      return jsonResponse(
        options.rpcBody ??
          emptyReport(params.get("from") ?? "", params.get("to") ?? ""),
        options.rpcStatus ?? 200,
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const headers = new Headers();
    if (authorization) headers.set("Authorization", authorization);
    const response = await GET(
      new Request(`http://localhost/api/business/reports?${query}`, {
        headers,
      }),
    );
    const body: unknown = await response.json();
    return { response, body, calls };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnon;
    if (originalService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalService;
  }
}

function currentQuery() {
  const today = getIstanbulCalendarDate(new Date());
  return `from=${today}&to=${today}`;
}

test("missing Authorization returns private no-store 401", async () => {
  const result = await runRoute(currentQuery(), {}, "");
  assert.equal(result.response.status, 401);
  assert.equal(
    result.response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.equal(result.calls.length, 0);
});

test("invalid bearer token returns 401 without ownership lookup", async () => {
  const result = await runRoute(currentQuery(), { authOk: false });
  assert.equal(result.response.status, 401);
  assert.equal(result.calls.length, 1);
  assert.equal((result.body as { code: string }).code, "UNAUTHORIZED");
});

for (const forbiddenParameter of ["businessId", "business_id"]) {
  test(`client ${forbiddenParameter} selection is rejected`, async () => {
    const result = await runRoute(
      `${currentQuery()}&${forbiddenParameter}=${serverBusinessId}`,
    );
    assert.equal(result.response.status, 400);
    assert.equal((result.body as { code: string }).code, "INVALID_QUERY");
    assert.equal(result.calls.length, 1);
  });
}

test("zero owned businesses returns controlled 404", async () => {
  const result = await runRoute(currentQuery(), { businesses: [] });
  assert.equal(result.response.status, 404);
  assert.equal((result.body as { code: string }).code, "BUSINESS_NOT_FOUND");
  assert.equal(result.calls.length, 2);
});

test("multiple owned businesses fail safe without client selection", async () => {
  const result = await runRoute(currentQuery(), {
    businesses: [
      { id: serverBusinessId },
      { id: "22222222-2222-4222-8222-222222222222" },
    ],
  });
  assert.equal(result.response.status, 409);
  assert.equal(
    (result.body as { code: string }).code,
    "BUSINESS_ACCOUNT_INVALID",
  );
  assert.equal(result.calls.length, 2);
});

test("successful RPC uses server-derived business ID and no-store fetch", async () => {
  const originalInfo = console.info;
  console.info = () => undefined;
  try {
    const result = await runRoute(currentQuery());
    assert.equal(result.response.status, 200);
    assert.equal(
      result.response.headers.get("cache-control"),
      "private, no-store, max-age=0",
    );
    const rpcCall = result.calls[2];
    assert.equal(rpcCall.init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(rpcCall.init?.body)), {
      p_business_id: serverBusinessId,
      p_from: new URLSearchParams(currentQuery()).get("from"),
      p_to: new URLSearchParams(currentQuery()).get("to"),
    });
    assert.equal(JSON.stringify(result.body).includes(serviceRoleKey), false);
  } finally {
    console.info = originalInfo;
  }
});

test("mixed currency RPC error maps to typed generic 422", async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const result = await runRoute(currentQuery(), {
      rpcStatus: 400,
      rpcBody: {
        code: "P0001",
        message: "unsupported_currency",
        details: "sensitive SQL details must not pass",
      },
    });
    assert.equal(result.response.status, 422);
    assert.equal(
      (result.body as { code: string }).code,
      "UNSUPPORTED_CURRENCY",
    );
    assert.equal(JSON.stringify(result.body).includes("SQL details"), false);
  } finally {
    console.warn = originalWarn;
  }
});

test("unexpected PII in RPC response fails closed with generic 500", async () => {
  const params = new URLSearchParams(currentQuery());
  const raw = {
    ...emptyReport(params.get("from") ?? "", params.get("to") ?? ""),
    customer_phone: "05550000000",
  };
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const result = await runRoute(currentQuery(), { rpcBody: raw });
    assert.equal(result.response.status, 500);
    assert.equal((result.body as { code: string }).code, "REPORT_UNAVAILABLE");
    assert.equal(JSON.stringify(result.body).includes("05550000000"), false);
  } finally {
    console.error = originalError;
  }
});

test("service role credential is used only in server-side RPC headers", async () => {
  const originalInfo = console.info;
  const logs: unknown[] = [];
  console.info = (...values: unknown[]) => logs.push(values);
  try {
    const result = await runRoute(currentQuery());
    const rpcHeaders = new Headers(result.calls[2].init?.headers);
    assert.equal(rpcHeaders.get("apikey"), serviceRoleKey);
    assert.equal(rpcHeaders.get("authorization"), `Bearer ${serviceRoleKey}`);
    assert.equal(JSON.stringify(logs).includes(serviceRoleKey), false);
    assert.equal(JSON.stringify(result.body).includes(serviceRoleKey), false);
  } finally {
    console.info = originalInfo;
  }
});
