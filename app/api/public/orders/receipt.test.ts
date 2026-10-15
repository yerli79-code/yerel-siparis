import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchRecordedOrderReceipt,
  // @ts-expect-error The existing tsx runner resolves source extensions.
} from "./receipt.ts";
const id = "22222222-2222-4222-8222-222222222222";
const key = "11111111-1111-4111-8111-111111111111";
const committed = { order_number: 7, total_amount: "120.00", order_type: "pickup" as const };
const row = () => ({ business_order_number: 7, total_amount: "120.00", order_type: "pickup",
  payment_method: "cash", currency: "TRY", businesses: { slug: "local-pilot" },
  order_items: [{ product_id: id, product_name: "Saved name", unit_price: "60.00", quantity: 2, line_total: "120.00" }] });
async function withFetch(mock: typeof fetch, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock;
  try { await run(); } finally { globalThis.fetch = previous; }
}
const read = () => fetchRecordedOrderReceipt("https://supabase.example.test", "synthetic-secret", "local-pilot", key, committed);
test("receipt read is GET/no-store and bound to business, key and committed order number", async () => {
  await withFetch(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://supabase.example.test");
    assert.equal(url.pathname, "/rest/v1/orders");
    assert.equal(url.searchParams.get("businesses.slug"), "eq.local-pilot");
    assert.equal(url.searchParams.get("idempotency_key"), `eq.${key}`);
    assert.equal(url.searchParams.get("business_order_number"), "eq.7");
    assert.equal(url.searchParams.get("limit"), "2");
    assert.match(url.searchParams.get("select")!, /businesses!inner\(slug\)/);
    assert.doesNotMatch(url.searchParams.get("select")!, /customer|owner|email/);
    assert.equal(init?.method, "GET"); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("apikey"), "synthetic-secret");
    return Response.json([row()]);
  }, async () => {
    const result = await read();
    assert.equal(result.totalAmount, 120);
    assert.equal(result.items[0].productName, "Saved name");
    assert.equal("businesses" in result, false);
  });
});
for (const [name, rows] of [
  ["empty", []], ["ambiguous", [row(), row()]],
  ["foreign business", [{ ...row(), businesses: { slug: "foreign" } }]],
  ["wrong order", [{ ...row(), business_order_number: 8 }]],
  ["wrong type", [{ ...row(), order_type: "delivery" }]],
  ["wrong total", [{ ...row(), total_amount: 121 }]],
  ["malformed items", [{ ...row(), order_items: [null] }]],
] as const) {
  test(`receipt fails closed for ${name}`, async () => {
    await withFetch(async () => Response.json(rows), async () => { await assert.rejects(read); });
  });
}
test("post-commit read failure never falls back to catalog or draft prices", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return Response.json({ error: "private detail" }, { status: 500 }); },
    async () => { await assert.rejects(read, /receipt unavailable/); assert.equal(calls, 1); });
});
