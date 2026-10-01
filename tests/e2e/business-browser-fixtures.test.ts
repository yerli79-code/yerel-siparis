import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockSupabaseServer } from "./mock-supabase-server";
import { BUSINESS_B, businessBFixtures } from "./business-browser-fixtures";
import { createInitialFixtures } from "./fixtures";

test("local HTTP B fixture supports password, refresh, user, scoped products/dashboard and reset", async () => {
  const mock = await createMockSupabaseServer();
  const b = businessBFixtures(), a = createInitialFixtures();
  try {
    const json = async (endpoint: string, method = "GET", body?: unknown) => {
      const r = await fetch(mock.baseUrl + endpoint, { method, headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      assert.equal(r.status, 200); return r.json();
    };
    await json("/__e2e/two-businesses", "POST");
    const login = await json("/auth/v1/token?grant_type=password", "POST", { email: BUSINESS_B.email, password: BUSINESS_B.password });
    assert.equal(login.user.id, BUSINESS_B.ownerId); assert.equal(login.access_token, BUSINESS_B.token);
    const refresh = await json("/auth/v1/token?grant_type=refresh_token", "POST", { refresh_token: login.refresh_token });
    assert.equal(refresh.user.id, login.user.id); assert.equal(refresh.access_token, login.access_token);
    const user = await fetch(mock.baseUrl + "/auth/v1/user", { headers: { Authorization: `Bearer ${refresh.access_token}` } });
    assert.equal(user.status, 200); assert.equal((await user.json()).id, BUSINESS_B.ownerId);
    for (const fixture of [a, b]) {
      const products = await json(`/rest/v1/products?business_id=eq.${fixture.business.id}`);
      assert.deepEqual(products.map((p: any) => p.id).sort(), fixture.products.map(p => p.id).sort());
      const summary = await json("/rest/v1/rpc/get_business_dashboard_summary", "POST", { p_business_id: fixture.business.id, p_date: "2026-09-21" });
      assert.equal(summary[0].total_orders, fixture.orders.length);
    }
    // Service-key/unscoped fixtures deliberately expose both accounts; app scoping is under test.
    assert.equal((await json("/rest/v1/products")).length, a.products.length + b.products.length);
    await json("/__e2e/reset", "POST");
    assert.equal(mock.getState().products.length, a.products.length);
    assert.equal((await fetch(mock.baseUrl + "/auth/v1/user", { headers: { Authorization: `Bearer ${BUSINESS_B.token}` } })).status, 401);
  } finally { await mock.close(); }
});
