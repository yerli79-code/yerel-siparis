import assert from "node:assert/strict";
import { createInitialFixtures, FIXTURE_ACCESS_TOKEN } from "./fixtures";

// Stateful service-key Data API double, deliberately WITHOUT owner filtering.
// Authorization must come from the real route handlers, not from this mock.
// No fallback to native fetch: unexpected destinations fail closed.
export function createTwoAccountMock() {
  const fixtures = createInitialFixtures();
  const a = { ...fixtures.business, subscription_expires_at: "2099-12-31T00:00:00.000Z" };
  const b = { ...fixtures.businesses[1], is_active: true, subscription_status: "active",
    subscription_expires_at: "2099-12-31T00:00:00.000Z", name: "Synthetic Business B" };
  assert.notEqual(a.owner_id, b.owner_id);
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const productsB = fixtures.products.slice(0, 3).map((p, i) => ({ ...p,
    id: uuid(6001 + i), business_id: b.id, name: `B product ${i}`, price: 701 + i }));
  const ordersB = fixtures.orders.slice(0, 3).map((o, i) => ({ ...o,
    id: uuid(7001 + i), business_id: b.id, business_order_number: 901 + i,
    customer_name: `B customer ${i}`, total_amount: 901 + i,
    status: i === 0 ? "delivered" as const : "new" as const }));
  const itemsB = ordersB.map((o, i) => ({ ...fixtures.orderItems[0],
    id: uuid(8001 + i), order_id: o.id, product_id: productsB[i].id,
    product_name: productsB[i].name, unit_price: productsB[i].price }));
  const state = { businesses: [a, b], products: [...fixtures.products, ...productsB],
    orders: [...fixtures.orders, ...ordersB], orderItems: [...fixtures.orderItems, ...itemsB] };
  // Keep summary data inside today's Istanbul calendar window on later runs too.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  state.orders.forEach(o => { o.created_at = `${today}T09:00:00.000Z`; });
  const accounts = [{ label: "A", businessId: a.id, ownerId: a.owner_id!, token: FIXTURE_ACCESS_TOKEN },
    { label: "B", businessId: b.id, ownerId: b.owner_id!, token: "mock-business-b-distinct-token" }];
  const calls: Array<{ url: URL; method: string; body: Record<string, unknown> }> = [];
  const writes: typeof calls = [];
  type Row = Record<string, unknown>;
  function matches(row: Row, params: URLSearchParams) {
    return [...params].every(([key, value]) => {
      if (["select", "order", "limit", "offset"].includes(key)) return true;
      if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
      if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
      if (key === "or") {
        const match = /^\(business_order_number.eq.(\d+)\)$/.exec(value);
        assert.ok(match, `Unsupported search ${value}`);
        return String(row.business_order_number) === match[1];
      }
      throw new Error(`Unsupported mock filter ${key}=${value}`);
    });
  }
  const fetchMock: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "http://127.0.0.1:4010", "Only synthetic local destination allowed");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    const call = { url, method, body };
    calls.push(call);
    if (url.pathname === "/auth/v1/user") {
      const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "");
      const account = accounts.find(a => a.token === token);
      return account ? Response.json({ id: account.ownerId }) : Response.json({}, { status: 401 });
    }
    assert.equal(new Headers(init.headers).get("apikey"), "two-account-local-secret");
    if (url.pathname === "/rest/v1/rpc/reorder_business_products_atomic") {
      const items = body.p_items as Array<{ productId: string; sortOrder: number; expectedUpdatedAt: string }>;
      // Model the checked-in atomic RPC contract, including all-or-nothing validation.
      const rows = items.map(i => state.products.find(p => p.id === i.productId && p.business_id === body.p_business_id));
      if (rows.some(p => !p)) return Response.json({ message: "PRODUCT_NOT_FOUND" }, { status: 404 });
      if (rows.some((p, i) => p!.updated_at !== items[i].expectedUpdatedAt))
        return Response.json({ message: "PRODUCT_CONFLICT" }, { status: 409 });
      writes.push(call);
      rows.forEach((p, i) => { p!.sort_order = items[i].sortOrder; p!.updated_at = "2026-10-01T15:00:00.000Z"; });
      return Response.json(rows);
    }
    if (url.pathname === "/rest/v1/rpc/get_business_dashboard_summary") {
      const start = new Date(`${body.p_date}T00:00:00+03:00`);
      const end = new Date(+start + 86400000);
      const orders = state.orders.filter(o => o.business_id === body.p_business_id &&
        Date.parse(o.created_at) >= +start && Date.parse(o.created_at) < +end);
      const count = (statuses: string[]) => orders.filter(o => statuses.includes(o.status)).length;
      return Response.json([{ range_start: start.toISOString(),
        range_end_exclusive: end.toISOString(),
        total_orders: orders.length, new_orders: count(["new"]), pending_orders: count(["new", "preparing", "ready"]),
        delivered_orders: count(["delivered"]), cancelled_orders: count(["cancelled"]), all_currency_try: true,
        delivered_revenue: orders.filter(o => o.status === "delivered").reduce((n, o) => n + o.total_amount, 0) }]);
    }
    const tables: Record<string, Row[]> = { businesses: state.businesses, products: state.products,
      orders: state.orders, order_items: state.orderItems };
    const table = tables[url.pathname.replace("/rest/v1/", "")];
    assert.ok(table, `Unexpected mock endpoint ${url.pathname}`);
    const matched = table.filter(row => matches(row, url.searchParams));
    if (method === "PATCH" || method === "DELETE") {
      writes.push(call);
      if (method === "PATCH") matched.forEach(row => Object.assign(row, body, { updated_at: "2026-10-01T15:00:00.000Z" }));
      else matched.forEach(row => table.splice(table.indexOf(row), 1));
      return Response.json(matched);
    }
    assert.equal(method, "GET");
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? matched.length);
    return Response.json(matched.slice(offset, offset + limit), { headers: {
      "Content-Range": `${offset}-${Math.max(offset, offset + Math.min(limit, matched.length) - 1)}/${matched.length}` } });
  };
  return { state, accounts, calls, writes, fetchMock };
}
