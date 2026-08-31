import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./route.ts";

const businessId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

function createSuccessfulFetch() {
  const fetchMock: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return Response.json({ id: userId });
    }
    if (url.pathname === "/rest/v1/businesses") {
      return Response.json([
        {
          id: businessId,
          owner_id: userId,
          is_active: true,
          subscription_status: "active",
          subscription_expires_at: "2099-12-31T00:00:00.000Z",
        },
      ]);
    }
    if (url.pathname === "/rest/v1/rpc/get_business_dashboard_summary") {
      return Response.json([
        {
          range_start: "2026-08-30T21:00:00.000Z",
          range_end_exclusive: "2026-08-31T21:00:00.000Z",
          total_orders: 3,
          new_orders: 1,
          pending_orders: 1,
          delivered_orders: 1,
          cancelled_orders: 1,
          all_currency_try: true,
          delivered_revenue: 125,
        },
      ]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return fetchMock;
}

function dashboardRequest(authorization = "Bearer owner-token") {
  return new Request(
    "https://panel.example.test/api/business/dashboard-summary",
    { headers: authorization ? { Authorization: authorization } : {} },
  );
}

async function withFetch(fetchMock: typeof fetch, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("dashboard summary success is private and not stored", async () => {
  await withFetch(createSuccessfulFetch(), async () => {
    const response = await GET(dashboardRequest());
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "private, no-store, max-age=0",
    );
  });
});

test("dashboard summary unauthorized response is private and not stored", async () => {
  const response = await GET(dashboardRequest(""));
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
});

test("dashboard success and controlled errors vary by Authorization", async () => {
  await withFetch(createSuccessfulFetch(), async () => {
    const response = await GET(dashboardRequest());
    assert.equal(response.headers.get("vary"), "Authorization");
  });

  const unauthorizedResponse = await GET(dashboardRequest(""));
  assert.equal(unauthorizedResponse.headers.get("vary"), "Authorization");
});
