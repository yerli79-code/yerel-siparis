import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationPath = resolve(
  "supabase/migrations/20260829061343_atomic_product_reorder.sql",
);
const sql = readFileSync(migrationPath, "utf8");

test("migration adds exactly the dedicated atomic reorder function", () => {
  assert.match(sql, /create or replace function public\.reorder_business_products_atomic\(/i);
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, 1);
  assert.doesNotMatch(sql, /create\s+table|alter\s+table|add\s+column/i);
});

test("function is security invoker with an explicit empty search path", () => {
  assert.match(sql, /security invoker[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(sql, /security definer/i);
});

test("RPC execution is revoked from browser roles and granted only to service_role", () => {
  assert.match(
    sql,
    /revoke execute on function public\.reorder_business_products_atomic\(uuid, jsonb\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.reorder_business_products_atomic\(uuid, jsonb\)[\s\S]*to service_role/i,
  );
});

test("all target rows are business scoped, deterministically locked, and counted", () => {
  assert.match(sql, /where product\.business_id = p_business_id[\s\S]*order by product\.id[\s\S]*for update of product/i);
  assert.match(sql, /v_locked_count <> v_requested_count[\s\S]*PRODUCT_NOT_FOUND/i);
});

test("duplicate product IDs and sort orders are rejected inside the RPC", () => {
  assert.match(sql, /count\(distinct requested\.item ->> 'productId'\)/i);
  assert.match(sql, /count\(distinct \(requested\.item ->> 'sortOrder'\)::integer\)/i);
});

test("every locked version is checked before the update", () => {
  assert.match(
    sql,
    /product\.updated_at is distinct from requested\."expectedUpdatedAt"[\s\S]*PRODUCT_CONFLICT/i,
  );
  assert.ok(sql.indexOf("PRODUCT_CONFLICT") < sql.indexOf("update public.products"));
});

test("reorder update writes only sort_order and skips unchanged rows", () => {
  const update = sql.slice(
    sql.indexOf("update public.products"),
    sql.indexOf("return query"),
  );
  const setClause = update.slice(
    update.indexOf("set "),
    update.indexOf("from jsonb_to_recordset"),
  );
  assert.match(update, /set sort_order = requested\."sortOrder"/i);
  assert.match(update, /product\.sort_order is distinct from requested\."sortOrder"/i);
  assert.doesNotMatch(
    setClause,
    /\b(name|price|description|category|image_url|image_label|is_active|business_id)\s*=/i,
  );
});

test("authoritative product rows are returned from the same transaction", () => {
  assert.match(sql, /returns setof public\.products/i);
  assert.match(sql, /return query[\s\S]*select product\.\*/i);
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/i);
});

test("migration does not alter RLS, policies, triggers, or product schema", () => {
  assert.doesNotMatch(
    sql,
    /row level security|create\s+policy|drop\s+policy|create\s+trigger|drop\s+trigger|references\s+public/i,
  );
});

test("migration does not recreate the existing updated_at trigger", () => {
  assert.doesNotMatch(sql, /products_set_updated_at|set_updated_at\s*\(/i);
});
