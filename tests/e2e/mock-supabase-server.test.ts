import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createMockSupabaseServer,
  type MockSupabaseServerInstance,
} from "./mock-supabase-server";
import {
  FIXTURE_ACCESS_TOKEN,
  FIXTURE_BUSINESS_ID,
  FIXTURE_USER_EMAIL,
  FIXTURE_USER_ID,
  FIXTURE_USER_PASSWORD,
  STALE_ORDER_UPDATED_AT,
  STALE_PRODUCT_UPDATED_AT,
} from "./fixtures";
import { isAllowedUrl } from "./browser-cdp-helper";
import {
  ALLOWED_PARENT_SYSTEM_ENV_VARS,
  createSanitizedChildEnv,
  scanRuntimeSupabaseEnvVars,
  validateDiscoveredEnvVars,
  validateEffectiveChildEnv,
  validateSafeUrl,
} from "./run-e2e";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let mockServer: MockSupabaseServerInstance;

test("setup: start mock supabase server on loopback", async () => {
  mockServer = await createMockSupabaseServer(0);
  assert.equal(mockServer.host, "127.0.0.1");
  assert(mockServer.port > 0);
  assert(mockServer.baseUrl.startsWith("http://127.0.0.1:"));
});

test("1. valid login returns 200 with tokens and user", async () => {
  const res = await fetch(`${mockServer.baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: FIXTURE_USER_EMAIL,
      password: FIXTURE_USER_PASSWORD,
    }),
  });
  assert.equal(res.status, 200);
  const data = (await res.json()) as Record<string, unknown>;
  assert.equal(data.access_token, FIXTURE_ACCESS_TOKEN);
  assert(typeof data.refresh_token === "string");
  assert(typeof data.expires_at === "number");
  assert.equal((data.user as { id: string }).id, FIXTURE_USER_ID);
});

test("2. invalid login returns 400 invalid_grant", async () => {
  const res = await fetch(`${mockServer.baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: FIXTURE_USER_EMAIL,
      password: "WrongPassword123!",
    }),
  });
  assert.equal(res.status, 400);
  const data = (await res.json()) as Record<string, unknown>;
  assert.equal(data.error, "invalid_grant");
});

test("3. authenticated /auth/v1/user returns 200 and user record", async () => {
  const res = await fetch(`${mockServer.baseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${FIXTURE_ACCESS_TOKEN}` },
  });
  assert.equal(res.status, 200);
  const user = (await res.json()) as { id: string; email: string };
  assert.equal(user.id, FIXTURE_USER_ID);
  assert.equal(user.email, FIXTURE_USER_EMAIL);
});

test("4. invalid token returns 401", async () => {
  const res = await fetch(`${mockServer.baseUrl}/auth/v1/user`, {
    headers: { Authorization: "Bearer bad-token-value" },
  });
  assert.equal(res.status, 401);
});

test("5. business lookup returns business record for owner", async () => {
  const res = await fetch(
    `${mockServer.baseUrl}/rest/v1/businesses?owner_id=eq.${FIXTURE_USER_ID}&select=*&limit=1`,
  );
  assert.equal(res.status, 200);
  const list = (await res.json()) as Array<{ id: string; name: string }>;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, FIXTURE_BUSINESS_ID);
  assert.equal(list[0].name, "E2E Test Kebap Salonu");
});

test("6. product listing returns array of products with valid UUIDs", async () => {
  const res = await fetch(
    `${mockServer.baseUrl}/rest/v1/products?business_id=eq.${FIXTURE_BUSINESS_ID}`,
  );
  assert.equal(res.status, 200);
  const products = (await res.json()) as Array<{ id: string; name: string }>;
  assert(products.length >= 5);
  for (const p of products) {
    assert(UUID_PATTERN.test(p.id), `Product ID must match UUID pattern: ${p.id}`);
  }
});

test("7. create product generates syntactically valid deterministic UUID v4", async () => {
  const priorCount = mockServer.getState().products.length;
  const res = await fetch(`${mockServer.baseUrl}/rest/v1/products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      name: "Yeni E2E Test Tatlısı",
      price: 95,
      category: "Tatlılar",
      description: "Taze yapılmış",
    }),
  });
  assert.equal(res.status, 201);
  const created = (await res.json()) as Array<{ id: string; name: string }>;
  assert.equal(created.length, 1);
  assert.equal(created[0].name, "Yeni E2E Test Tatlısı");
  assert(UUID_PATTERN.test(created[0].id), `Generated ID must match UUID pattern: ${created[0].id}`);
  assert.equal(created[0].id, "00000000-0000-4000-8000-000000009001");
  assert.equal(mockServer.getState().products.length, priorCount + 1);
});

test("8. inject order generates syntactically valid deterministic UUID v4", async () => {
  const res = await fetch(`${mockServer.baseUrl}/__e2e/inject-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "new",
      customer_name: "Enjekte Sipariş Müşterisi",
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { order: { id: string; customer_name: string } };
  assert(UUID_PATTERN.test(body.order.id), `Injected order ID must match UUID pattern: ${body.order.id}`);
  assert.equal(body.order.id, "00000000-0000-4000-8000-000000008001");
});

test("9. product reorder exact production contract returns complete product rows", async () => {
  const products = mockServer.getState().products;
  const p1 = products[0];
  const p2 = products[1];

  const payload = {
    p_business_id: FIXTURE_BUSINESS_ID,
    p_items: [
      { productId: p1.id, sortOrder: 10, expectedUpdatedAt: p1.updated_at },
      { productId: p2.id, sortOrder: 20, expectedUpdatedAt: p2.updated_at },
    ],
  };

  const res = await fetch(`${mockServer.baseUrl}/rest/v1/rpc/reorder_business_products_atomic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 200);
  const result = (await res.json()) as Array<{
    id: string;
    business_id: string;
    client_product_id: string | null;
    name: string;
    price: number;
    description: string | null;
    category: string | null;
    image_label: string | null;
    image_url: string | null;
    is_active: boolean;
    sort_order: number;
    created_at: string;
    updated_at: string;
  }>;

  assert.equal(result.length, 2);
  const row1 = result.find((r) => r.id === p1.id);
  assert(row1);
  assert.equal(row1.sort_order, 10);
  assert.equal(row1.business_id, FIXTURE_BUSINESS_ID);
  assert(typeof row1.name === "string" && row1.name.length > 0);
  assert(typeof row1.created_at === "string");
  assert(typeof row1.updated_at === "string");

  const row2 = result.find((r) => r.id === p2.id);
  assert(row2);
  assert.equal(row2.sort_order, 20);
});

test("10. reorder stale-version conflict returns 409 with PRODUCT_CONFLICT message", async () => {
  const p1 = mockServer.getState().products[0];
  const payload = {
    p_business_id: FIXTURE_BUSINESS_ID,
    p_items: [
      { productId: p1.id, sortOrder: 99, expectedUpdatedAt: STALE_PRODUCT_UPDATED_AT },
    ],
  };

  const res = await fetch(`${mockServer.baseUrl}/rest/v1/rpc/reorder_business_products_atomic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 409);
  const data = (await res.json()) as { message: string };
  assert.equal(data.message, "PRODUCT_CONFLICT");
});

test("11. reorder missing product returns 404 with PRODUCT_NOT_FOUND message", async () => {
  const payload = {
    p_business_id: FIXTURE_BUSINESS_ID,
    p_items: [
      { productId: "00000000-0000-4000-8000-999999999999", sortOrder: 1, expectedUpdatedAt: "2026-01-01" },
    ],
  };

  const res = await fetch(`${mockServer.baseUrl}/rest/v1/rpc/reorder_business_products_atomic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(res.status, 404);
  const data = (await res.json()) as { message: string };
  assert.equal(data.message, "PRODUCT_NOT_FOUND");
});

test("12. dashboard RPC exact production contract returns 1-row array", async () => {
  const res = await fetch(`${mockServer.baseUrl}/rest/v1/rpc/get_business_dashboard_summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      p_business_id: FIXTURE_BUSINESS_ID,
      p_date: "2026-09-21",
    }),
  });
  assert.equal(res.status, 200);
  const rows = (await res.json()) as Array<{
    range_start: string;
    range_end_exclusive: string;
    total_orders: number;
    new_orders: number;
    pending_orders: number;
    delivered_orders: number;
    cancelled_orders: number;
    all_currency_try: boolean;
    delivered_revenue: number;
  }>;

  assert(Array.isArray(rows));
  assert.equal(rows.length, 1);
  const summary = rows[0];

  assert(summary.range_start.startsWith("2026-09-21"));
  assert(Date.parse(summary.range_start) < Date.parse(summary.range_end_exclusive));
  assert.equal(summary.all_currency_try, true);
  assert.equal(
    summary.total_orders,
    summary.pending_orders + summary.delivered_orders + summary.cancelled_orders,
  );
  assert(summary.new_orders <= summary.pending_orders);
  assert(summary.delivered_revenue > 0);
});

test("13. product conditional update success returns [fullUpdatedProduct]", async () => {
  const target = mockServer.getState().products[0];
  const url = `${mockServer.baseUrl}/rest/v1/products?id=eq.${target.id}&business_id=eq.${target.business_id}&updated_at=eq.${target.updated_at}&select=*`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ price: 210 }),
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as Array<{ id: string; price: number }>;
  assert.equal(updated.length, 1);
  assert.equal(updated[0].price, 210);
});

test("14. product conditional stale update returns 200 [] without mutating state", async () => {
  const target = mockServer.getState().products[0];
  const originalPrice = target.price;
  const url = `${mockServer.baseUrl}/rest/v1/products?id=eq.${target.id}&business_id=eq.${target.business_id}&updated_at=eq.${STALE_PRODUCT_UPDATED_AT}&select=*`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ price: 999 }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as unknown[];
  assert.equal(body.length, 0);

  // State must not have mutated
  const current = mockServer.getState().products.find((p) => p.id === target.id)!;
  assert.equal(current.price, originalPrice);
});

test("15. product conditional delete returns [deletedProduct] and removes from state", async () => {
  const target = mockServer.getState().products[mockServer.getState().products.length - 1];
  const url = `${mockServer.baseUrl}/rest/v1/products?id=eq.${target.id}&business_id=eq.${target.business_id}&updated_at=eq.${target.updated_at}&select=*`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  assert.equal(res.status, 200);
  const deleted = (await res.json()) as Array<{ id: string }>;
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].id, target.id);
  assert.equal(mockServer.getState().products.some((p) => p.id === target.id), false);
});

test("16. product conditional stale delete returns 200 [] and preserves state", async () => {
  const target = mockServer.getState().products[0];
  const url = `${mockServer.baseUrl}/rest/v1/products?id=eq.${target.id}&business_id=eq.${target.business_id}&updated_at=eq.${STALE_PRODUCT_UPDATED_AT}&select=*`;

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as unknown[];
  assert.equal(body.length, 0);
  assert.equal(mockServer.getState().products.some((p) => p.id === target.id), true);
});

test("17. order conditional update success returns [updatedOrder]", async () => {
  const target = mockServer.getState().orders[0];
  const url = `${mockServer.baseUrl}/rest/v1/orders?id=eq.${target.id}&business_id=eq.${target.business_id}&updated_at=eq.${target.updated_at}&select=*`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ status: "preparing" }),
  });
  assert.equal(res.status, 200);
  const updated = (await res.json()) as Array<{ id: string; status: string }>;
  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, "preparing");
});

test("18. order conditional stale update returns 200 [] without mutation", async () => {
  const target = mockServer.getState().orders[0];
  const originalStatus = target.status;
  const url = `${mockServer.baseUrl}/rest/v1/orders?id=eq.${target.id}&business_id=eq.${target.business_id}&updated_at=eq.${STALE_ORDER_UPDATED_AT}&select=*`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as unknown[];
  assert.equal(body.length, 0);

  const current = mockServer.getState().orders.find((o) => o.id === target.id)!;
  assert.equal(current.status, originalStatus);
});

test("19. order list query with limit, offset, and Content-Range", async () => {
  const res = await fetch(
    `${mockServer.baseUrl}/rest/v1/orders?business_id=eq.${FIXTURE_BUSINESS_ID}&limit=2&offset=1`,
  );
  assert.equal(res.status, 200);
  const contentRange = res.headers.get("content-range");
  assert(contentRange);
  assert(contentRange.startsWith("1-2/"));
  const orders = (await res.json()) as unknown[];
  assert.equal(orders.length, 2);
});

test("20. order list customer name search via or=(...)", async () => {
  const res = await fetch(
    `${mockServer.baseUrl}/rest/v1/orders?business_id=eq.${FIXTURE_BUSINESS_ID}&or=(customer_name.ilike."%Ahmet%")`,
  );
  assert.equal(res.status, 200);
  const orders = (await res.json()) as Array<{ customer_name: string }>;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].customer_name, "Ahmet Yılmaz");
});

test("21. order list phone search via or=(...)", async () => {
  const res = await fetch(
    `${mockServer.baseUrl}/rest/v1/orders?business_id=eq.${FIXTURE_BUSINESS_ID}&or=(customer_phone.ilike."%05559876543%")`,
  );
  assert.equal(res.status, 200);
  const orders = (await res.json()) as Array<{ customer_phone: string }>;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].customer_phone, "05559876543");
});

test("22. order list exact order number search via or=(...)", async () => {
  const res = await fetch(
    `${mockServer.baseUrl}/rest/v1/orders?business_id=eq.${FIXTURE_BUSINESS_ID}&or=(business_order_number.eq.103)`,
  );
  assert.equal(res.status, 200);
  const orders = (await res.json()) as Array<{ business_order_number: number }>;
  assert.equal(orders.length, 1);
  assert.equal(orders[0].business_order_number, 103);
});

test("23. order list multiple created_at filters (gte and lt window)", async () => {
  const res = await fetch(
    `${mockServer.baseUrl}/rest/v1/orders?business_id=eq.${FIXTURE_BUSINESS_ID}&created_at=gte.2026-09-21T12:00:00.000Z&created_at=lt.2026-09-21T12:20:00.000Z`,
  );
  assert.equal(res.status, 200);
  const orders = (await res.json()) as Array<{ created_at: string }>;
  assert(orders.length > 0);
  for (const o of orders) {
    assert(o.created_at >= "2026-09-21T12:00:00.000Z");
    assert(o.created_at < "2026-09-21T12:20:00.000Z");
  }
});

test("24. fixture reset restores original deterministic state and resets counters", async () => {
  const res = await fetch(`${mockServer.baseUrl}/__e2e/reset`, { method: "POST" });
  assert.equal(res.status, 200);
  const state = mockServer.getState();
  assert.equal(state.products.length, 6);
  assert.equal(state.orders.length, 5);

  // Next created product after reset should get counter 9001 again
  const createRes = await fetch(`${mockServer.baseUrl}/rest/v1/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ name: "Reset Test Product" }),
  });
  const created = (await createRes.json()) as Array<{ id: string }>;
  assert.equal(created[0].id, "00000000-0000-4000-8000-000000009001");
});

test("25. real validateSafeUrl rejects non-loopback and hosted domains", () => {
  assert.equal(validateSafeUrl("http://127.0.0.1:4010"), undefined);
  assert.throws(() => validateSafeUrl("https://127.0.0.1:4010"), /Non-http protocol detected/);
  assert.throws(() => validateSafeUrl("http://0.0.0.0:4010"), /Non-loopback hostname detected/);
  assert.throws(() => validateSafeUrl("http://xyz.supabase.co"), /Hosted domain target detected/);
  assert.throws(() => validateSafeUrl("http://yerelsiparis.com"), /Hosted domain target detected/);
});

test("26. real validateEffectiveChildEnv verifies loopback and rejects leaks", () => {
  const validChildEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:4010",
    SUPABASE_URL: "http://127.0.0.1:4010",
    SUPABASE_DB_URL: "postgresql://postgres:dummy@127.0.0.1:5432/dummy",
  };
  assert.equal(validateEffectiveChildEnv(validChildEnv), undefined);

  assert.throws(
    () =>
      validateEffectiveChildEnv({
        ...validChildEnv,
        NEXT_PUBLIC_SUPABASE_URL: "http://192.168.1.1:4010",
      }),
    /NEXT_PUBLIC_SUPABASE_URL is not loopback/,
  );

  assert.throws(
    () =>
      validateEffectiveChildEnv({
        ...validChildEnv,
        SUPABASE_URL: "https://evil.supabase.co",
      }),
    /SUPABASE_URL is not loopback/,
  );
});

test("27. hostile parent env containment and explicit allowlist test", () => {
  const hostileParentEnv = {
    PATH: process.env.PATH || "C:\\Windows\\system32",
    SystemRoot: process.env.SystemRoot || "C:\\Windows",
    TEMP: process.env.TEMP || "C:\\Temp",
    NUMBER_OF_PROCESSORS: process.env.NUMBER_OF_PROCESSORS || "8",
    OPENAI_API_KEY: "fake-hostile-openai-key",
    DATABASE_URL: "postgresql://user:pass@evil.host:5432/db",
    SENTRY_DSN: "https://fake@sentry.io/12345",
    RESEND_API_KEY: "re_fake_hostile_resend_key",
    AWS_ACCESS_KEY_ID: "AKIAFAKEHOSTILEKEY",
    AWS_SECRET_ACCESS_KEY: "fake-hostile-aws-secret",
    STRIPE_SECRET_KEY: "sk_test_fake_stripe_secret",
    GOOGLE_CLIENT_SECRET: "fake_google_client_secret",
    CUSTOM_BUSINESS_SECRET: "fake_custom_secret",
    NEXT_PUBLIC_SUPABASE_URL: "https://evil-test.supabase.co",
    SUPABASE_URL: "https://evil-test.supabase.co",
    SUPABASE_DB_URL: "postgresql://example.invalid/not-real",
    SUPABASE_SERVER_SECRET_KEY: "fake_hostile_secret",
    SUPABASE_BACKUP_SECRET_KEY: "fake_hostile_backup_secret",
  };

  const sanitized = createSanitizedChildEnv(hostileParentEnv);

  // A. Hostile unrelated parent credentials must NOT be inherited
  assert.equal("OPENAI_API_KEY" in sanitized, false, "OPENAI_API_KEY must not be inherited");
  assert.equal("DATABASE_URL" in sanitized, false, "DATABASE_URL must not be inherited");
  assert.equal("SENTRY_DSN" in sanitized, false, "SENTRY_DSN must not be inherited");
  assert.equal("RESEND_API_KEY" in sanitized, false, "RESEND_API_KEY must not be inherited");
  assert.equal("AWS_ACCESS_KEY_ID" in sanitized, false, "AWS_ACCESS_KEY_ID must not be inherited");
  assert.equal("AWS_SECRET_ACCESS_KEY" in sanitized, false, "AWS_SECRET_ACCESS_KEY must not be inherited");
  assert.equal("STRIPE_SECRET_KEY" in sanitized, false, "STRIPE_SECRET_KEY must not be inherited");
  assert.equal("GOOGLE_CLIENT_SECRET" in sanitized, false, "GOOGLE_CLIENT_SECRET must not be inherited");
  assert.equal("CUSTOM_BUSINESS_SECRET" in sanitized, false, "CUSTOM_BUSINESS_SECRET must not be inherited");

  // B. Required Windows/runtime env survives
  assert.equal(sanitized.PATH, hostileParentEnv.PATH);
  assert.equal(sanitized.SystemRoot, hostileParentEnv.SystemRoot);
  assert.equal(sanitized.TEMP, hostileParentEnv.TEMP);
  assert.equal(sanitized.NUMBER_OF_PROCESSORS, hostileParentEnv.NUMBER_OF_PROCESSORS);

  // C. All Supabase values remain synthetic/loopback
  assert.equal(sanitized.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:4010");
  assert.equal(sanitized.SUPABASE_URL, "http://127.0.0.1:4010");
  assert.equal(sanitized.SUPABASE_DB_URL, "postgresql://postgres:dummy@127.0.0.1:5432/dummy");
  assert.equal(sanitized.SUPABASE_SERVER_SECRET_KEY, "e2e_local_dummy_server_secret_key_000000000000");
  assert.equal(sanitized.SUPABASE_BACKUP_SECRET_KEY, "e2e_local_dummy_backup_secret");
  assert.equal(sanitized.NO_PROXY, "127.0.0.1,localhost");
  assert.equal(sanitized.NEXT_TELEMETRY_DISABLED, "1");

  // Must pass real validateEffectiveChildEnv
  assert.equal(validateEffectiveChildEnv(sanitized), undefined);
});

test("28. hardened scanner detects dot notation, bracket notation, root files, and aborts on unknown", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-scanner-test-"));

  try {
    // Root file with dot notation
    fs.writeFileSync(
      path.join(tempDir, "middleware.ts"),
      "const url = process.env.NEXT_PUBLIC_SUPABASE_URL;",
      "utf8",
    );
    // Subdir file with bracket notation and literal token
    const subDir = path.join(tempDir, "lib");
    fs.mkdirSync(subDir);
    fs.writeFileSync(
      path.join(subDir, "auth.ts"),
      "const secret = process.env['SUPABASE_SERVER_SECRET_KEY']; const anon = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';",
      "utf8",
    );

    const discovered = scanRuntimeSupabaseEnvVars(tempDir);
    assert(discovered.has("NEXT_PUBLIC_SUPABASE_URL"), "Must detect dot notation in root file");
    assert(discovered.has("SUPABASE_SERVER_SECRET_KEY"), "Must detect bracket notation in subdir file");
    assert(discovered.has("NEXT_PUBLIC_SUPABASE_ANON_KEY"), "Must detect literal token");

    // Must validate successfully against allowlist
    assert.equal(validateDiscoveredEnvVars(discovered), undefined);

    // Now inject unknown variable and verify rejection
    discovered.add("SUPABASE_UNKNOWN_DANGEROUS_KEY");
    assert.throws(
      () => validateDiscoveredEnvVars(discovered),
      /Unknown Supabase env variable\(s\) found in runtime code/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("29. storage upload and public URL contract matches production client", async () => {
  const objectPath = `${FIXTURE_BUSINESS_ID}/test-image.png`;
  const uploadUrl = `${mockServer.baseUrl}/storage/v1/object/product-images/${objectPath}`;
  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: "dummy-anon-key",
      Authorization: "Bearer mock-user-access-token",
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: Buffer.from("dummy-png-data"),
  });
  assert.equal(uploadRes.status, 200);
  const uploadData = (await uploadRes.json()) as { Key: string; Id: string };
  assert.equal(uploadData.Key, `product-images/${objectPath}`);

  // Public URL check
  const publicUrl = `${mockServer.baseUrl}/storage/v1/object/public/product-images/${objectPath}`;
  assert(publicUrl.startsWith("http://127.0.0.1:"));
  const publicRes = await fetch(publicUrl);
  assert.equal(publicRes.status, 200);
  assert.equal(publicRes.headers.get("content-type"), "image/png");
  const buffer = await publicRes.arrayBuffer();
  assert(buffer.byteLength > 0);
});

test("30. browser egress pre-network interceptor allows only safe loopback targets", () => {
  // Allowed loopback & internal targets
  assert.equal(isAllowedUrl("http://127.0.0.1:3100/"), true);
  assert.equal(isAllowedUrl("http://127.0.0.1:3100/panel"), true);
  assert.equal(isAllowedUrl("http://127.0.0.1:4010/rest/v1/products"), true);
  assert.equal(isAllowedUrl("data:image/png;base64,iVBORw0KGgo="), true);
  assert.equal(isAllowedUrl("blob:http://127.0.0.1:3100/uuid"), true);
  assert.equal(isAllowedUrl("about:blank"), true);

  // Blocked external targets
  assert.equal(isAllowedUrl("https://example.com"), false);
  assert.equal(isAllowedUrl("https://yerelsiparis.com"), false);
  assert.equal(isAllowedUrl("https://api.supabase.co"), false);
  assert.equal(isAllowedUrl("https://subdomain.supabase.co/rest/v1"), false);
  assert.equal(isAllowedUrl("http://127.0.0.1:8080/evil"), false);
  assert.equal(isAllowedUrl("http://127.0.0.1:5432/"), false);
  assert.equal(isAllowedUrl("http://localhost:3100/"), false);
  assert.equal(isAllowedUrl("ftp://127.0.0.1:3100"), false);
});

test("teardown: close mock supabase server", async () => {
  await mockServer.close();
});
