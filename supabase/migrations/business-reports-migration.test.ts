import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(
  new URL("./20260811153000_add_business_reports_rpc.sql", import.meta.url),
  "utf8",
);
const normalized = sql.replace(/\s+/g, " ").toLowerCase();

test("migration creates only the requested three-argument JSONB RPC", () => {
  assert.match(
    normalized,
    /create or replace function public\.get_business_report\( p_business_id uuid, p_from date, p_to date \) returns jsonb/,
  );
  assert.doesNotMatch(normalized, /create\s+table|alter\s+table|create\s+index/);
});

test("RPC is stable SECURITY INVOKER with a fixed search_path", () => {
  assert.match(normalized, /language plpgsql stable security invoker/);
  assert.match(normalized, /set search_path = pg_catalog, public/);
  assert.doesNotMatch(normalized, /security definer/);
});

test("RPC execution is revoked from browser roles and granted to service_role", () => {
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(
      normalized,
      new RegExp(
        `revoke execute on function public\\.get_business_report\\(uuid, date, date\\) from ${role}`,
      ),
    );
  }
  assert.match(
    normalized,
    /grant execute on function public\.get_business_report\(uuid, date, date\) to service_role/,
  );
});

test("RPC contains no dynamic SQL or raw SQL concatenation", () => {
  assert.doesNotMatch(normalized, /\bexecute\b\s+(format|immediate|v_|\()/);
  assert.doesNotMatch(normalized, /\bquote_(ident|literal)\b/);
});

test("Istanbul inclusive dates become half-open timestamptz boundaries", () => {
  assert.match(
    normalized,
    /p_from::timestamp at time zone 'europe\/istanbul'/,
  );
  assert.match(
    normalized,
    /\(p_to \+ 1\)::timestamp at time zone 'europe\/istanbul'/,
  );
  assert.match(normalized, /o\.created_at >= v_range_start/);
  assert.match(normalized, /o\.created_at < v_range_end_exclusive/);
  assert.doesNotMatch(normalized, /created_at::date/);
});

test("database defense rejects null, reversed, and over-180-day ranges", () => {
  assert.match(normalized, /p_business_id is null or p_from is null or p_to is null/);
  assert.match(normalized, /p_from > p_to or \(p_to - p_from\) > 179/);
});

test("completed sales and average are delivered-only PostgreSQL numeric calculations", () => {
  assert.match(
    normalized,
    /sum\(total_amount\) filter \(where status = 'delivered'\)/,
  );
  assert.match(
    normalized,
    /kpi\.completed_sales \/ kpi\.completed_orders/,
  );
  assert.match(normalized, /when kpi\.completed_orders = 0 then null/);
});

test("cancelled orders are counted but never enter the delivered relation", () => {
  assert.match(
    normalized,
    /count\(\*\) filter \(where status = 'cancelled'\)/,
  );
  assert.match(
    normalized,
    /delivered_orders as materialized \( select \* from report_orders where status = 'delivered' \)/,
  );
});

test("sold item quantity comes only from delivered order items", () => {
  assert.match(
    normalized,
    /sum\(oi\.quantity\)[\s\S]*from delivered_orders as delivered join public\.order_items as oi/,
  );
});

test("daily trend is zero-filled and grouped in Istanbul local dates", () => {
  assert.match(normalized, /generate_series\(0, p_to - p_from\)/);
  assert.match(
    normalized,
    /\(o\.created_at at time zone 'europe\/istanbul'\)::date/,
  );
  assert.match(normalized, /left join daily_rollup as rollup using \(report_date\)/);
});

test("product history uses order_items snapshots rather than current products", () => {
  assert.match(normalized, /oi\.product_name/);
  assert.match(normalized, /oi\.line_total/);
  assert.match(normalized, /oi\.quantity/);
  assert.doesNotMatch(normalized, /public\.products/);
});

test("same product_id snapshots merge and newest snapshot name wins", () => {
  assert.match(normalized, /'product:' \|\| lower\(item\.product_id::text\)/);
  assert.match(
    normalized,
    /array_agg\( item\.product_name order by item\.order_created_at desc, item\.item_created_at desc, item\.item_id desc \)/,
  );
  assert.match(normalized, /group by item\.logical_key, item\.product_id/);
});

test("null product IDs use normalized SHA-256 keys with documented limitation", () => {
  assert.match(
    normalized,
    /regexp_replace\(btrim\(oi\.product_name\), '\[\[:space:\]\]\+', ' ', 'g'\)/,
  );
  assert.match(normalized, /extensions\.digest\([\s\S]*'sha256'/);
  assert.match(normalized, /equal normalized snapshot names therefore merge by design/);
});

test("products use delivered line revenue and deterministic revenue sorting", () => {
  assert.match(normalized, /sum\(item\.line_total\)/);
  assert.match(
    normalized,
    /product\.revenue desc, product\.quantity desc, product\.logical_key collate "c"/,
  );
});

test("payment report keeps cash, card, and legacy null unknown buckets", () => {
  assert.match(normalized, /'cash'::text, 'nakit'::text/);
  assert.match(normalized, /'card'::text, 'kart'::text/);
  assert.match(normalized, /'unknown'::text, 'belirtilmemiş'::text/);
  assert.match(normalized, /coalesce\(delivered\.payment_method, 'unknown'\)/);
});

test("order type report preserves Teslimat and Gel-al terminology", () => {
  assert.match(normalized, /'delivery'::text, 'teslimat'::text/);
  assert.match(normalized, /'pickup'::text, 'gel-al'::text/);
  assert.doesNotMatch(normalized, /paket servis/);
});

test("all five order statuses are emitted from the full report order set", () => {
  for (const status of ["new", "preparing", "ready", "delivered", "cancelled"]) {
    assert.match(normalized, new RegExp(`'${status}'::text`));
  }
  assert.match(normalized, /from report_orders as o group by o\.status/);
});

test("money output is formatted as two-decimal strings in PostgreSQL", () => {
  assert.match(normalized, /to_char\( round\(kpi\.completed_sales, 2\)/);
  assert.match(normalized, /fm999999999999999999999999990\.00/);
  assert.ok((normalized.match(/to_char\(/g) ?? []).length >= 6);
});

test("mixed currencies fail closed before aggregation", () => {
  assert.match(normalized, /o\.currency is distinct from 'try'/);
  assert.match(normalized, /raise exception 'unsupported_currency'/);
});

test("migration emits only aggregate fields and contains no customer PII", () => {
  for (const field of [
    "customer_name",
    "customer_phone",
    "customer_address",
    "customer_note",
    "idempotency_payload_hash",
    "authorization",
  ]) {
    assert.doesNotMatch(normalized, new RegExp(field));
  }
});

test("migration leaves retention, cron, and P3.3 print flow untouched", () => {
  assert.doesNotMatch(normalized, /purge_expired_orders|cron\.|180 days/);
  assert.doesNotMatch(normalized, /print_job|print/);
});
