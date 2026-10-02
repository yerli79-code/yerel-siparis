import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserCDPClient } from "./browser-cdp-helper";
import { BUSINESS_B } from "./business-browser-fixtures";
import { createInitialFixtures, FIXTURE_ACCESS_TOKEN, FIXTURE_USER_EMAIL, FIXTURE_USER_PASSWORD } from "./fixtures";

const app = "http://127.0.0.1:3100", mock = "http://127.0.0.1:4010";
const sessionKey = "yerel-siparis-business-session";
const baseline = createInitialFixtures();
const accounts = [
  { label: "A", email: FIXTURE_USER_EMAIL, password: FIXTURE_USER_PASSWORD,
    token: FIXTURE_ACCESS_TOKEN, name: baseline.business.name, businessId: baseline.business.id },
  { label: "B", ...BUSINESS_B },
];
const clients = [new BrowserCDPClient(), new BrowserCDPClient()];
const checks: string[] = [];
function pass(name: string) { checks.push(name); console.log(`PASS ${name}`); }
async function until(client: BrowserCDPClient, expression: string) {
  for (let i = 0; i < 150; i++) {
    if (await client.evaluate<boolean>(expression)) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Browser condition timeout: ${expression}`);
}
async function login(i: number) {
  const c = clients[i], a = accounts[i];
  await c.navigate(`${app}/giris`);
  await c.type("#email", a.email);
  await c.type("#password", a.password);
  await c.click("button[type='submit']");
  await until(c, `location.pathname === '/panel' && document.body.innerText.includes(${JSON.stringify(a.name)})`);
  assert.equal(await c.evaluate(`JSON.parse(sessionStorage.getItem('${sessionKey}')).access_token === ${JSON.stringify(a.token)}`), true);
}
async function api(i: number, endpoint: string, method = "GET", body?: unknown) {
  // Read the application's actual stored session; never inject the expected fixture token.
  return clients[i].evaluate<{ status: number; body: any }>(`(async () => {
    const session = JSON.parse(sessionStorage.getItem('${sessionKey}'));
    const r = await fetch('/api/business/' + ${JSON.stringify(endpoint)}, {
      method: ${JSON.stringify(method)}, headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      ${body === undefined ? "" : `body: JSON.stringify(${JSON.stringify(body)}),`}
    });
    return { status: r.status, body: await r.json() };
  })()`);
}
async function rows(table: string) { return (await fetch(`${mock}/rest/v1/${table}`)).json(); }
async function state() {
  return { businesses: await rows("businesses"), products: await rows("products"),
    orders: await rows("orders"), items: await rows("order_items") };
}
async function ownData(i: number) {
  const a = accounts[i], other = accounts[1 - i], c = clients[i];
  assert.equal(await c.evaluate(`document.body.innerText.includes(${JSON.stringify(other.name)})`), false);
  const products = await api(i, "products"), orders = await api(i, "orders?pageSize=10"), dashboard = await api(i, "dashboard-summary");
  for (const r of [products, orders, dashboard]) assert.equal(r.status, 200);
  const rawProducts = (await rows("products")).filter((p: any) => p.business_id === a.businessId);
  const rawOrders = (await rows("orders")).filter((o: any) => o.business_id === a.businessId);
  assert.deepEqual(products.body.products.map((p: any) => p.id).sort(), rawProducts.map((p: any) => p.id).sort());
  assert.deepEqual(orders.body.orders.map((o: any) => o.id).sort(), rawOrders.map((o: any) => o.id).sort());
  assert.equal(dashboard.body.orders.total, rawOrders.length);
  assert.equal(dashboard.body.orders.new, rawOrders.filter((o: any) => o.status === "new").length);
  assert.equal(dashboard.body.revenue.delivered, rawOrders.filter((o: any) => o.status === "delivered").reduce((sum: number, o: any) => sum + o.total_amount, 0));
  const ownItems = (await rows("order_items")).filter((item: any) => rawOrders.some((o: any) => o.id === item.order_id));
  assert.deepEqual(orders.body.orders.flatMap((o: any) => o.items.map((item: any) => item.id)).sort(), ownItems.map((item: any) => item.id).sort());
  for (const [tab, names] of [["Ürünler", rawProducts.map((p: any) => p.name)], ["Siparişler", rawOrders.map((o: any) => o.customer_name)]] as const) {
    await c.evaluate(`Array.from(document.querySelectorAll("nav[aria-label='Panel bölümleri'] button")).find(b => b.textContent.includes(${JSON.stringify(tab)})).click()`);
    await until(c, `document.body.innerText.includes(${JSON.stringify(names[0])})`);
    const text = await c.evaluate<string>("document.body.innerText");
    for (const name of names) assert.ok(text.includes(name), `${a.label} DOM missing ${name}`);
    const foreign = tab === "Ürünler" ? (await rows("products")).filter((p: any) => p.business_id === other.businessId).map((p: any) => p.name)
      : (await rows("orders")).filter((o: any) => o.business_id === other.businessId).map((o: any) => o.customer_name);
    for (const name of foreign) assert.ok(!text.includes(name), `${a.label} DOM leaked foreign data`);
  }
}
async function cross(i: number) {
  const a = accounts[i], other = accounts[1 - i];
  const p = (await rows("products")).find((p: any) => p.business_id === other.businessId);
  const o = (await rows("orders")).find((o: any) => o.business_id === other.businessId);
  const before = await state();
  const search = await api(i, `orders?search=${encodeURIComponent(o.customer_name)}`);
  assert.equal(search.status, 200); assert.equal(search.body.orders.length, 0);
  const numberSearch = await api(i, `orders?search=%23${o.business_order_number}`);
  assert.equal(numberSearch.status, 200); assert.equal(numberSearch.body.orders.length, 0);
  for (const selector of ["businessId", "business_id"]) {
    assert.equal((await api(i, `orders?${selector}=${other.businessId}`)).status, 400);
    assert.equal((await api(i, `dashboard-summary?${selector}=${other.businessId}`)).status, 400);
    const forgedProducts = await api(i, `products?${selector}=${other.businessId}`);
    assert.equal(forgedProducts.status, 200);
    assert.ok(forgedProducts.body.products.every((row: any) => row.business_id === a.businessId));
  }
  assert.equal((await api(i, `orders/${o.id}`, "PATCH", { status: "preparing", expectedUpdatedAt: o.updated_at })).status, 404);
  assert.equal((await api(i, `products/${p.id}`, "PATCH", { input: { price: 1111 }, expectedUpdatedAt: p.updated_at })).status, 404);
  assert.equal((await api(i, `products/${p.id}`, "DELETE", { expectedUpdatedAt: p.updated_at })).status, 404);
  assert.equal((await api(i, "update-profile", "POST", { businessId: other.businessId, input: { name: "Denied cross-account name" } })).status, 403);
  assert.deepEqual(await state(), before, "Rejected mutations must preserve both accounts and timestamps");
  pass(`${a.label} → ${other.label} read/mutation isolation; unchanged rows`);
}
async function run() {
  try {
    assert.equal((await fetch(`${mock}/__e2e/two-businesses`, { method: "POST" })).status, 200);
    await clients[0].launch({ port: 9233 }); await clients[1].launch({ port: 9234 });
    pass("Separate Chrome processes and temporary user-data profiles");
    for (const i of [0, 1]) { await login(i); pass(`${accounts[i].label} browser login /panel`); await ownData(i); pass(`${accounts[i].label} own DOM/products/orders/dashboard`); await cross(i); }
    for (const i of [0, 1, 0, 1]) { await clients[i].send("Page.bringToFront"); await ownData(i); }
    pass("A → B → A → B context switching");
    for (const i of [0, 1]) {
      // Force the application's ordinary refresh path, then perform a real reload.
      await clients[i].evaluate(`(() => { const s = JSON.parse(sessionStorage.getItem('${sessionKey}')); s.expires_at = 1; sessionStorage.setItem('${sessionKey}', JSON.stringify(s)); })()`);
      await clients[i].send("Page.reload", { ignoreCache: true });
      await until(clients[i], `document.body?.innerText.includes(${JSON.stringify(accounts[i].name)}) === true`);
      await ownData(i); pass(`${accounts[i].label} reload and refresh session isolation`);
      await clients[i].click("button.business-panel-logout");
      await until(clients[i], "location.pathname === '/giris'");
      assert.equal(await clients[i].evaluate(`sessionStorage.getItem('${sessionKey}')`), null);
      await clients[i].navigate(`${app}/panel`);
      await until(clients[i], "location.pathname === '/giris'");
      await login(i); await ownData(i); await ownData(1 - i);
      pass(`${accounts[i].label} logout/login isolation; other session retained`);
    }
    const network = clients.map((c, i) => {
      assert.equal(c.egressViolation, false); assert.equal(c.blockedRequests.length, 0);
      for (const n of c.networkLogs) {
        assert.equal(c.requestHeaderMatches(n, 'authorization', `Bearer ${accounts[1 - i].token}`), false,
          `${accounts[i].label} network must never contain the other account's token`);
      }
      // CORS preflight carries no Authorization by design; assert the actual requests.
      const authenticated = c.networkLogs.filter(n => n.method !== 'OPTIONS' && (n.url.includes('/api/business/') || n.url.includes('/auth/v1/user') || n.url.includes('/rest/v1/businesses')));
      assert.ok(authenticated.length > 0);
      for (const n of authenticated) {
        assert.equal(c.requestHeaderMatches(n, 'authorization', `Bearer ${accounts[i].token}`), true,
          `${accounts[i].label} ${n.method} ${new URL(n.url).pathname} must use its session token`);
      }
      assert.ok(c.networkLogs.some(n => n.url.includes('grant_type=refresh_token') && n.status === 200));
      return { context: accounts[i].label, tokenIdentity: `fixture-${accounts[i].label}`, authenticatedRequests: authenticated.length,
        requests: authenticated.map(n => ({ method: n.method, path: new URL(n.url).pathname, status: n.status, tokenIdentity: `fixture-${accounts[i].label}` })) };
    });
    pass("A/B network token separation; local egress only");
    const report = path.join(os.tmpdir(), `business-browser-isolation-${Date.now()}.json`);
    fs.writeFileSync(report, JSON.stringify({ checks, network }, null, 2), { flag: 'wx' });
    console.log(`Evidence: ${report}`);
  } finally { for (const c of clients) await c.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
