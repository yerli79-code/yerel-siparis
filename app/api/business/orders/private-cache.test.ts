import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GET,
  // @ts-expect-error The local TypeScript test runner resolves source extensions.
} from "./route.ts";

const orderId = "11111111-1111-4111-8111-111111111111";
const businessId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";

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
    if (url.pathname === "/rest/v1/orders") {
      return Response.json(
        [
          {
            id: orderId,
            order_number: 41,
            business_order_number: 7,
            business_id: businessId,
            status: "new",
            order_type: "delivery",
            payment_method: "cash",
            customer_name: "Test Musteri",
            customer_phone: "+905551112233",
            customer_address: "Test adresi",
            customer_note: null,
            total_amount: 125,
            currency: "TRY",
            created_at: "2026-08-31T08:00:00.000Z",
            updated_at: "2026-08-31T08:00:00.000Z",
          },
        ],
        { headers: { "Content-Range": "0-0/1" } },
      );
    }
    if (url.pathname === "/rest/v1/order_items") {
      return Response.json([
        {
          id: "55555555-5555-4555-8555-555555555555",
          order_id: orderId,
          product_id: productId,
          product_name: "Test Urun",
          unit_price: 125,
          quantity: 1,
          line_total: 125,
          created_at: "2026-08-31T08:00:00.000Z",
        },
      ]);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return fetchMock;
}

function ordersRequest(authorization = "Bearer owner-token") {
  return new Request("https://panel.example.test/api/business/orders", {
    headers: authorization ? { Authorization: authorization } : {},
  });
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

test("orders GET success is private and not stored", async () => {
  await withFetch(createSuccessfulFetch(), async () => {
    const response = await GET(ordersRequest());
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("cache-control"),
      "private, no-store, max-age=0",
    );
  });
});

test("orders GET unauthorized response is private and not stored", async () => {
  const response = await GET(ordersRequest(""));
  assert.ok(response);
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
});

test("orders GET success and controlled errors vary by Authorization", async () => {
  await withFetch(createSuccessfulFetch(), async () => {
    const response = await GET(ordersRequest());
    assert.ok(response);
    assert.equal(response.headers.get("vary"), "Authorization");
  });

  const unauthorizedResponse = await GET(ordersRequest(""));
  assert.ok(unauthorizedResponse);
  assert.equal(unauthorizedResponse.headers.get("vary"), "Authorization");
});
