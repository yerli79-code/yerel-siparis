import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AdminBusinessQueryError,
  ADMIN_BUSINESS_LIST_SELECT,
  buildAdminBusinessRestParams,
  buildOwnerEmailSearchParams,
  getAdminBusinessRange,
  getAdminBusinessTotalPages,
  parseAdminBusinessListQuery,
  parsePostgrestTotal,
  quotePostgrestLikePattern,
  type AdminBusinessListQuery,
  // @ts-expect-error Node's type-stripping test runner requires the source extension.
} from "./business-list-contract.ts";

function query(overrides: Partial<AdminBusinessListQuery> = {}): AdminBusinessListQuery {
  return {
    q: "",
    page: 1,
    pageSize: 20,
    access: "all",
    subscription: "all",
    created: "all",
    sort: "newest",
    city: "",
    district: "",
    ...overrides,
  };
}

test("query contract supplies controlled defaults", () => {
  assert.deepEqual(parseAdminBusinessListQuery(new URLSearchParams()), query());
});

test("page 1 and pageSize 20 are accepted", () => {
  const parsed = parseAdminBusinessListQuery(new URLSearchParams("page=1&pageSize=20"));
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 20);
});

test("page zero is rejected", () => {
  assert.throws(
    () => parseAdminBusinessListQuery(new URLSearchParams("page=0")),
    AdminBusinessQueryError,
  );
});

test("negative page is rejected", () => {
  assert.throws(
    () => parseAdminBusinessListQuery(new URLSearchParams("page=-1")),
    AdminBusinessQueryError,
  );
});

test("pageSize 50 is accepted and 51 is rejected", () => {
  assert.equal(
    parseAdminBusinessListQuery(new URLSearchParams("pageSize=50")).pageSize,
    50,
  );
  assert.throws(
    () => parseAdminBusinessListQuery(new URLSearchParams("pageSize=51")),
    AdminBusinessQueryError,
  );
});

test("explicit invalid enum values are rejected", () => {
  for (const invalid of [
    "sort=random",
    "access=blocked",
    "subscription=trial",
    "created=yesterday",
  ]) {
    assert.throws(
      () => parseAdminBusinessListQuery(new URLSearchParams(invalid)),
      AdminBusinessQueryError,
    );
  }
});

test("duplicate and unknown query parameters are rejected", () => {
  assert.throws(
    () => parseAdminBusinessListQuery(new URLSearchParams("page=1&page=2")),
    AdminBusinessQueryError,
  );
  assert.throws(
    () => parseAdminBusinessListQuery(new URLSearchParams("raw=drop")),
    AdminBusinessQueryError,
  );
});

test("search is trimmed and limited to 100 characters", () => {
  assert.equal(parseAdminBusinessListQuery(new URLSearchParams("q=%20kebap%20")).q, "kebap");
  assert.equal(
    parseAdminBusinessListQuery(new URLSearchParams(`q=${"a".repeat(100)}`)).q.length,
    100,
  );
  assert.throws(
    () => parseAdminBusinessListQuery(new URLSearchParams(`q=${"a".repeat(101)}`)),
    AdminBusinessQueryError,
  );
});

test("page ranges are inclusive and stable", () => {
  assert.deepEqual(getAdminBusinessRange(1, 20), { from: 0, to: 19 });
  assert.deepEqual(getAdminBusinessRange(2, 20), { from: 20, to: 39 });
});

test("total pages cover 0, 1, 20, 21 and 50+ records", () => {
  assert.equal(getAdminBusinessTotalPages(0, 20), 0);
  assert.equal(getAdminBusinessTotalPages(1, 20), 1);
  assert.equal(getAdminBusinessTotalPages(20, 20), 1);
  assert.equal(getAdminBusinessTotalPages(21, 20), 2);
  assert.equal(getAdminBusinessTotalPages(57, 20), 3);
});

test("newest and name sorts include stable id tie-breakers", () => {
  assert.equal(buildAdminBusinessRestParams(query(), [], new Date(0)).get("order"), "created_at.desc,id.desc");
  assert.equal(
    buildAdminBusinessRestParams(query({ sort: "name_asc" }), [], new Date(0)).get("order"),
    "name.asc,id.asc",
  );
});

test("list query uses only the explicit minimal select", () => {
  const params = buildAdminBusinessRestParams(query(), [], new Date(0));
  assert.equal(params.get("select"), ADMIN_BUSINESS_LIST_SELECT);
  assert.doesNotMatch(params.get("select") ?? "", /\*/);
});

test("access and location filters stay controlled", () => {
  const params = buildAdminBusinessRestParams(
    query({ access: "passive", city: "İstanbul", district: "Kadıköy" }),
    [],
    new Date(0),
  );
  assert.equal(params.get("is_active"), "eq.false");
  assert.equal(params.get("city"), "eq.İstanbul");
  assert.equal(params.get("district"), "eq.Kadıköy");

  const contradictory = buildAdminBusinessRestParams(
    query({ access: "active", subscription: "passive" }),
    [],
    new Date(0),
  );
  assert.deepEqual(contradictory.getAll("is_active"), ["eq.true", "eq.false"]);
});

test("subscription filters preserve active, expired, passive and blocked semantics", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");
  const active = buildAdminBusinessRestParams(query({ subscription: "active" }), [], now);
  assert.equal(active.get("is_active"), "eq.true");
  assert.equal(active.get("subscription_status"), "eq.active");
  assert.equal(active.get("subscription_expires_at"), `gt.${now.toISOString()}`);

  const expired = buildAdminBusinessRestParams(query({ subscription: "expired" }), [], now);
  assert.match(expired.get("and") ?? "", /subscription_status\.neq\.blocked/);
  assert.match(expired.get("and") ?? "", /subscription_expires_at\.is\.null/);

  const passive = buildAdminBusinessRestParams(query({ subscription: "passive" }), [], now);
  assert.equal(passive.get("is_active"), "eq.false");
  assert.equal(passive.get("subscription_status"), "neq.blocked");

  const blocked = buildAdminBusinessRestParams(query({ subscription: "blocked" }), [], now);
  assert.equal(blocked.get("subscription_status"), "eq.blocked");
});

test("ending and created filters use bounded server timestamps", () => {
  const now = new Date("2026-08-14T12:00:00.000Z");
  const ending = buildAdminBusinessRestParams(query({ subscription: "ending30" }), [], now);
  assert.deepEqual(ending.getAll("subscription_expires_at"), [
    `gt.${now.toISOString()}`,
    "lte.2026-09-13T12:00:00.000Z",
  ]);
  const created = buildAdminBusinessRestParams(query({ created: "last7" }), [], now);
  assert.deepEqual(created.getAll("created_at"), [
    "gte.2026-08-07T12:00:00.000Z",
    `lte.${now.toISOString()}`,
  ]);
});

test("search spans business fields and only validated owner UUIDs", () => {
  const safeId = "11111111-1111-4111-8111-111111111111";
  const params = buildAdminBusinessRestParams(
    query({ q: "kebap" }),
    [safeId, "not-a-uuid"],
    new Date(0),
  );
  const filter = params.get("or") ?? "";
  for (const field of [
    "name",
    "slug",
    "whatsapp_order_number",
    "city",
    "district",
    "neighborhood",
    "address",
  ]) {
    assert.match(filter, new RegExp(`${field}\\.ilike`));
  }
  assert.match(filter, new RegExp(`owner_id\\.in\\.\\(${safeId}\\)`));
  assert.doesNotMatch(filter, /not-a-uuid/);
});

test("PostgREST search quoting safely handles reserved and wildcard characters", () => {
  for (const value of [",", "%", "(", ")", "apostrophe'", "back\\slash", "wild*card", 'quote"']) {
    const pattern = quotePostgrestLikePattern(value);
    assert.ok(pattern.startsWith('"*'));
    assert.ok(pattern.endsWith('*"'));
    const encoded = buildOwnerEmailSearchParams(value).toString();
    assert.match(encoded, /^select=id&email=ilike\./);
    assert.doesNotThrow(() => new URLSearchParams(encoded));
  }
});

test("PostgREST exact count header produces pagination totals", () => {
  assert.equal(parsePostgrestTotal("0-19/57"), 57);
  assert.equal(parsePostgrestTotal("*/0"), 0);
  assert.throws(() => parsePostgrestTotal(null), AdminBusinessQueryError);
});
