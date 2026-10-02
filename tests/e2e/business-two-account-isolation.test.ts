import assert from "node:assert/strict";
import { test } from "node:test";
import { createTwoAccountMock } from "./business-two-account-mock";
import { GET as orders } from "../../app/api/business/orders/route";
import * as orderDetail from "../../app/api/business/orders/[orderId]/route";
import { GET as products } from "../../app/api/business/products/route";
import { PATCH as patchProduct, DELETE as deleteProduct } from "../../app/api/business/products/[productId]/route";
import { POST as reorder } from "../../app/api/business/products/reorder/route";
import { POST as profile } from "../../app/api/business/update-profile/route";
import { GET as summary } from "../../app/api/business/dashboard-summary/route";

type Mock = ReturnType<typeof createTwoAccountMock>;
type Account = Mock["accounts"][number];
function request(account: Account, endpoint: string, method = "GET", body?: unknown) {
  return new Request(`http://127.0.0.1:3100/api/business/${endpoint}`, {
    method, headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function withMock(run: (mock: Mock) => Promise<void>) {
  const mock = createTwoAccountMock();
  const previousFetch = globalThis.fetch;
  const keys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVER_SECRET_KEY"];
  const saved = keys.map(k => process.env[k]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:4010";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_two_account_local";
  process.env.SUPABASE_SERVER_SECRET_KEY = "two-account-local-secret";
  globalThis.fetch = mock.fetchMock;
  try { await run(mock); } finally {
    globalThis.fetch = previousFetch;
    keys.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i]; });
  }
}
async function success(response: Response | undefined) {
  assert.ok(response, "Route must return a response");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("vary"), "Authorization");
  return response.json();
}
async function denied(mock: Mock, run: () => Promise<Response | undefined>, status: number, code?: string) {
  const before = structuredClone(mock.state);
  const writesBefore = mock.writes.length;
  const response = await run();
  assert.ok(response, "Route must return a response");
  assert.equal(response.status, status, await response.clone().text());
  if (code) assert.equal((await response.json()).code, code);
  assert.deepEqual(mock.state, before, "Denied mutation must preserve ALL rows and timestamps in both accounts");
  assert.equal(mock.writes.length, writesBefore, "Denied operation must not reach a mock write");
}

test("two-account fixture authenticates distinct owners and fails closed off loopback", async () => {
  await withMock(async mock => {
    assert.notEqual(mock.accounts[0].ownerId, mock.accounts[1].ownerId);
    assert.notEqual(mock.accounts[0].token, mock.accounts[1].token);
    for (const a of mock.accounts) {
      const response = await fetch("http://127.0.0.1:4010/auth/v1/user", { headers: { Authorization: `Bearer ${a.token}` } });
      assert.equal((await response.json()).id, a.ownerId);
    }
    await assert.rejects(fetch("https://forbidden.example.invalid/rest/v1/orders"), /Only synthetic local destination/);
  });
});

test("switching A → B → A in one shared state never reuses another owner's reads", async () => {
  await withMock(async mock => {
    // A direct service-key query is intentionally capable of seeing both owners.
    // This ensures the mock itself cannot hide a missing application owner scope.
    const unscoped = await fetch("http://127.0.0.1:4010/rest/v1/orders", {
      headers: { apikey: "two-account-local-secret" },
    });
    assert.equal((await unscoped.json()).length, mock.state.orders.length);
    for (const own of [mock.accounts[0], mock.accounts[1], mock.accounts[0]]) {
      const expected = mock.state.orders.filter(o => o.business_id === own.businessId);
      const result = await success(await orders(request(own, "orders?limit=1")));
      assert.equal(result.orders.length, 1);
      assert.ok(expected.some(o => o.id === result.orders[0].id));
      assert.equal(result.pagination.total, expected.length, "Count is independent of page limit");
      const dashboard = await success(await summary(request(own, "dashboard-summary")));
      assert.equal(dashboard.orders.total, expected.length);
    }
  });
});

for (const index of [0, 1]) {
  const label = index === 0 ? "A → B" : "B → A";
  test(`${label}: own order list, exact count, items and foreign detail search`, async () => {
    await withMock(async mock => {
      const own = mock.accounts[index], other = mock.accounts[1 - index];
      const ownRows = mock.state.orders.filter(o => o.business_id === own.businessId);
      const foreignRows = mock.state.orders.filter(o => o.business_id === other.businessId);
      const result = await success(await orders(request(own, "orders?pageSize=10")));
      assert.deepEqual(result.orders.map((o: { id: string }) => o.id).sort(), ownRows.map(o => o.id).sort());
      assert.equal(result.pagination.total, ownRows.length);
      const newOnly = await success(await orders(request(own, "orders?status=new&pageSize=10")));
      assert.equal(newOnly.pagination.total, ownRows.filter(o => o.status === "new").length,
        "Panel new-order badge must count only this owner's new orders");
      assert.ok(newOnly.orders.every((o: { id: string; status: string }) =>
        o.status === "new" && ownRows.some(row => row.id === o.id)));
      assert.notEqual(ownRows.length, foreignRows.length, "Counts must distinguish accounts");
      const ownItems = mock.state.orderItems.filter(i => ownRows.some(o => o.id === i.order_id));
      assert.deepEqual(result.orders.flatMap((o: { items: Array<{ id: string }> }) => o.items.map(i => i.id)).sort(), ownItems.map(i => i.id).sort());
      const foreignDetail = await success(await orders(request(own, `orders?search=%23${foreignRows[0].business_order_number}`)));
      assert.deepEqual(foreignDetail.orders, []);
      assert.equal(foreignDetail.pagination.total, 0);
      await denied(mock, () => orders(request(own, `orders?businessId=${other.businessId}`)), 400, "INVALID_QUERY");
      await denied(mock, () => orders(request(own, `orders?business_id=${other.businessId}`)), 400, "INVALID_QUERY");
      // There is no separate GET detail route; details are embedded in the list.
      assert.equal("GET" in orderDetail, false);
    });
  });
  test(`${label}: product reads ignore forged business selectors and stay owner scoped`, async () => {
    await withMock(async mock => {
      const own = mock.accounts[index], other = mock.accounts[1 - index];
      const expected = mock.state.products.filter(p => p.business_id === own.businessId);
      for (const query of ["", `?businessId=${other.businessId}`, `?business_id=${other.businessId}`]) {
        const result = await success(await products(request(own, `products${query}`)));
        assert.deepEqual(result.products.map((p: { id: string }) => p.id).sort(), expected.map(p => p.id).sort());
        assert.ok(result.products.every((p: { business_id: string }) => p.business_id === own.businessId));
      }
    });
  });
  test(`${label}: dashboard counts and revenue differ; foreign selector rejected before RPC`, async () => {
    await withMock(async mock => {
      const own = mock.accounts[index], other = mock.accounts[1 - index];
      const ownRows = mock.state.orders.filter(o => o.business_id === own.businessId);
      const result = await success(await summary(request(own, "dashboard-summary")));
      assert.equal(result.orders.total, ownRows.length);
      assert.equal(result.orders.new, ownRows.filter(o => o.status === "new").length);
      assert.equal(result.revenue.delivered, ownRows.filter(o => o.status === "delivered").reduce((n, o) => n + o.total_amount, 0));
      const rpc = mock.calls.find(c => c.url.pathname.endsWith("get_business_dashboard_summary"));
      assert.equal(rpc?.body.p_business_id, own.businessId);
      const rpcCount = mock.calls.filter(c => c.url.pathname.includes("/rpc/")).length;
      for (const key of ["businessId", "business_id"]) {
        await denied(mock, () => summary(request(own, `dashboard-summary?${key}=${other.businessId}`)), 400, "INVALID_DATE");
      }
      assert.equal(mock.calls.filter(c => c.url.pathname.includes("/rpc/")).length, rpcCount);
    });
  });
  test(`${label}: foreign order PATCH rejected with no state change; own PATCH persists`, async () => {
    await withMock(async mock => {
      const own = mock.accounts[index], other = mock.accounts[1 - index];
      const foreign = mock.state.orders.find(o => o.business_id === other.businessId)!;
      await denied(mock, () => orderDetail.PATCH(request(own, `orders/${foreign.id}`, "PATCH", {
        status: "preparing", expectedUpdatedAt: foreign.updated_at,
      }), { params: Promise.resolve({ orderId: foreign.id }) }), 404, "ORDER_NOT_FOUND");
      const otherBefore = structuredClone(mock.state.orders.filter(o => o.business_id === other.businessId));
      const target = mock.state.orders.find(o => o.business_id === own.businessId && o.status === "new")!;
      const result = await success(await orderDetail.PATCH(request(own, `orders/${target.id}`, "PATCH", {
        status: "preparing", expectedUpdatedAt: target.updated_at,
      }), { params: Promise.resolve({ orderId: target.id }) }));
      assert.equal(result.order.id, target.id);
      assert.equal(target.status, "preparing");
      assert.deepEqual(mock.state.orders.filter(o => o.business_id === other.businessId), otherBefore);
    });
  });
  for (const method of ["PATCH", "DELETE"] as const) {
    test(`${label}: foreign product ${method} rejected with no state change; own write persists`, async () => {
      await withMock(async mock => {
        const own = mock.accounts[index], other = mock.accounts[1 - index];
        const foreign = mock.state.products.find(p => p.business_id === other.businessId)!;
        const handler = method === "PATCH" ? patchProduct : deleteProduct;
        const payload = (updatedAt: string) => ({ expectedUpdatedAt: updatedAt, ...(method === "PATCH" ? { input: { price: 1111 } } : {}) });
        await denied(mock, () => handler(request(own, `products/${foreign.id}`, method, payload(foreign.updated_at)),
          { params: Promise.resolve({ productId: foreign.id }) }), 404, "PRODUCT_NOT_FOUND");
        const otherBefore = structuredClone(mock.state.products.filter(p => p.business_id === other.businessId));
        const target = mock.state.products.find(p => p.business_id === own.businessId)!;
        await success(await handler(request(own, `products/${target.id}`, method, payload(target.updated_at)),
          { params: Promise.resolve({ productId: target.id }) }));
        if (method === "PATCH") assert.equal(target.price, 1111);
        else assert.equal(mock.state.products.some(p => p.id === target.id), false);
        assert.deepEqual(mock.state.products.filter(p => p.business_id === other.businessId), otherBefore);
      });
    });
  }
  test(`${label}: foreign and mixed reorder are atomic; own reorder persists`, async () => {
    await withMock(async mock => {
      const own = mock.accounts[index], other = mock.accounts[1 - index];
      const ownRows = mock.state.products.filter(p => p.business_id === own.businessId).slice(0, 2);
      const foreign = mock.state.products.filter(p => p.business_id === other.businessId).slice(0, 2);
      const payload = (rows: typeof ownRows) => ({ items: rows.map((p, i) => ({ productId: p.id, sortOrder: 30 - i, expectedUpdatedAt: p.updated_at })) });
      for (const rows of [foreign, [ownRows[0], foreign[0]]]) {
        await denied(mock, () => reorder(request(own, "products/reorder", "POST", payload(rows))), 404, "PRODUCT_NOT_FOUND");
        assert.equal(mock.calls.at(-1)?.body.p_business_id, own.businessId);
      }
      const otherBefore = structuredClone(foreign);
      const result = await success(await reorder(request(own, "products/reorder", "POST", payload(ownRows))));
      assert.equal(result.products.length, 2);
      assert.deepEqual(ownRows.map(p => p.sort_order), [30, 29]);
      assert.deepEqual(foreign, otherBefore);
    });
  });
  test(`${label}: foreign profile update rejected with no state change; own profile persists`, async () => {
    await withMock(async mock => {
      const own = mock.accounts[index], other = mock.accounts[1 - index];
      const payload = (id: string) => ({ businessId: id, input: { name: `Updated synthetic ${own.label}` } });
      await denied(mock, () => profile(request(own, "update-profile", "POST", payload(other.businessId))), 403);
      const otherBefore = structuredClone(mock.state.businesses.find(b => b.id === other.businessId));
      const result = await success(await profile(request(own, "update-profile", "POST", payload(own.businessId))));
      assert.equal(result.business.id, own.businessId);
      assert.equal(mock.state.businesses.find(b => b.id === own.businessId)?.name, `Updated synthetic ${own.label}`);
      assert.deepEqual(mock.state.businesses.find(b => b.id === other.businessId), otherBefore);
    });
  });
}
