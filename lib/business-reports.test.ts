import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BusinessReportRequestError,
  BusinessReportRpcValidationError,
  getBusinessReportRangeBoundaries,
  getIstanbulCalendarDate,
  getIstanbulDayStartIso,
  parseBusinessReportQuery,
  parseBusinessReportRpcResult,
  type BusinessReportQuery,
} from "./business-reports";

const now = new Date("2026-08-11T12:00:00.000Z");

function parse(query: string, date = now) {
  return parseBusinessReportQuery(new URLSearchParams(query), date);
}

function assertRequestError(
  query: string,
  code: BusinessReportRequestError["code"],
) {
  assert.throws(
    () => parse(query),
    (error: unknown) =>
      error instanceof BusinessReportRequestError && error.code === code,
  );
}

test("same-day report range is accepted", () => {
  assert.deepEqual(parse("from=2026-08-11&to=2026-08-11"), {
    from: "2026-08-11",
    to: "2026-08-11",
  });
});

test("7-day report range is accepted", () => {
  assert.deepEqual(parse("from=2026-08-05&to=2026-08-11"), {
    from: "2026-08-05",
    to: "2026-08-11",
  });
});

test("30-day report range is accepted", () => {
  assert.deepEqual(parse("from=2026-07-13&to=2026-08-11"), {
    from: "2026-07-13",
    to: "2026-08-11",
  });
});

test("exactly 180 inclusive calendar days are accepted", () => {
  assert.deepEqual(parse("from=2026-02-13&to=2026-08-11"), {
    from: "2026-02-13",
    to: "2026-08-11",
  });
});

test("181 inclusive calendar days are rejected", () => {
  assertRequestError(
    "from=2026-02-12&to=2026-08-11",
    "DATE_OUT_OF_RANGE",
  );
});

test("invalid month is rejected", () => {
  assertRequestError("from=2026-13-01&to=2026-08-11", "INVALID_DATE");
});

test("invalid leap date is rejected", () => {
  assertRequestError("from=2026-02-29&to=2026-08-11", "INVALID_DATE");
});

test("from after to is rejected", () => {
  assertRequestError("from=2026-08-11&to=2026-08-10", "INVALID_DATE");
});

test("future to date is rejected", () => {
  assertRequestError(
    "from=2026-08-11&to=2026-08-12",
    "DATE_OUT_OF_RANGE",
  );
});

test("from older than the retained 180 calendar days is rejected", () => {
  assertRequestError(
    "from=2026-02-12&to=2026-02-13",
    "DATE_OUT_OF_RANGE",
  );
});

test("duplicate from is rejected", () => {
  assertRequestError(
    "from=2026-08-10&from=2026-08-11&to=2026-08-11",
    "INVALID_QUERY",
  );
});

test("duplicate to is rejected", () => {
  assertRequestError(
    "from=2026-08-10&to=2026-08-10&to=2026-08-11",
    "INVALID_QUERY",
  );
});

test("unknown parameter is rejected", () => {
  assertRequestError(
    "from=2026-08-10&to=2026-08-11&businessId=attacker",
    "INVALID_QUERY",
  );
});

test("both required parameters must be present", () => {
  assertRequestError("from=2026-08-10", "INVALID_QUERY");
  assertRequestError("to=2026-08-11", "INVALID_QUERY");
});

test("Istanbul today is independent from the host timezone", () => {
  assert.equal(
    getIstanbulCalendarDate(new Date("2026-08-10T20:59:59.999Z")),
    "2026-08-10",
  );
  assert.equal(
    getIstanbulCalendarDate(new Date("2026-08-10T21:00:00.000Z")),
    "2026-08-11",
  );
});

test("Istanbul local midnight maps to the correct UTC boundary", () => {
  assert.equal(
    getIstanbulDayStartIso("2026-08-11"),
    "2026-08-10T21:00:00.000Z",
  );
  assert.deepEqual(
    getBusinessReportRangeBoundaries({
      from: "2026-08-10",
      to: "2026-08-11",
    }),
    {
      rangeStart: "2026-08-09T21:00:00.000Z",
      rangeEndExclusive: "2026-08-11T21:00:00.000Z",
    },
  );
});

function validRpcReport(query: BusinessReportQuery = {
  from: "2026-08-10",
  to: "2026-08-11",
}) {
  const bounds = getBusinessReportRangeBoundaries(query);
  return {
    schemaVersion: 1,
    business: { name: "Ornek Kebap" },
    period: {
      from: query.from,
      to: query.to,
      timezone: "Europe/Istanbul",
      rangeStart: bounds.rangeStart,
      rangeEndExclusive: bounds.rangeEndExclusive,
      generatedAt: "2026-08-11T12:00:00.000Z",
    },
    currency: "TRY",
    kpis: {
      totalOrders: 4,
      completedOrders: 2,
      cancelledOrders: 1,
      completedSales: "300.00",
      averageOrderValue: "150.00",
      soldItemQuantity: 3,
    },
    daily: [
      {
        date: "2026-08-10",
        totalOrders: 1,
        completedOrders: 1,
        completedSales: "100.00",
      },
      {
        date: "2026-08-11",
        totalOrders: 3,
        completedOrders: 1,
        completedSales: "200.00",
      },
    ],
    products: [
      {
        key: "product:11111111-1111-4111-8111-111111111111",
        productId: "11111111-1111-4111-8111-111111111111",
        name: "Yeni Urun Adi",
        quantity: 2,
        orderCount: 1,
        revenue: "200.00",
        sharePercent: 66.67,
      },
      {
        key: `legacy:${"a".repeat(64)}`,
        productId: null,
        name: "Silinmis Urun",
        quantity: 1,
        orderCount: 1,
        revenue: "100.00",
        sharePercent: 33.33,
      },
    ],
    payments: [
      {
        method: "cash",
        label: "Nakit",
        orderCount: 1,
        revenue: "100.00",
        sharePercent: 33.33,
      },
      {
        method: "card",
        label: "Kart",
        orderCount: 0,
        revenue: "0.00",
        sharePercent: 0,
      },
      {
        method: "unknown",
        label: "Belirtilmemiş",
        orderCount: 1,
        revenue: "200.00",
        sharePercent: 66.67,
      },
    ],
    orderTypes: [
      {
        type: "delivery",
        label: "Teslimat",
        orderCount: 1,
        revenue: "100.00",
        sharePercent: 33.33,
      },
      {
        type: "pickup",
        label: "Gel-al",
        orderCount: 1,
        revenue: "200.00",
        sharePercent: 66.67,
      },
    ],
    statuses: [
      { status: "new", count: 1, sharePercent: 25 },
      { status: "preparing", count: 0, sharePercent: 0 },
      { status: "ready", count: 0, sharePercent: 0 },
      { status: "delivered", count: 2, sharePercent: 50 },
      { status: "cancelled", count: 1, sharePercent: 25 },
    ],
  };
}

function emptyRpcReport(query: BusinessReportQuery) {
  const report = validRpcReport(query);
  report.kpis = {
    totalOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    completedSales: "0.00",
    averageOrderValue: null as unknown as string,
    soldItemQuantity: 0,
  };
  report.daily = report.daily.map((day) => ({
    ...day,
    totalOrders: 0,
    completedOrders: 0,
    completedSales: "0.00",
  }));
  report.products = [];
  report.payments = report.payments.map((item) => ({
    ...item,
    orderCount: 0,
    revenue: "0.00",
    sharePercent: 0,
  }));
  report.orderTypes = report.orderTypes.map((item) => ({
    ...item,
    orderCount: 0,
    revenue: "0.00",
    sharePercent: 0,
  }));
  report.statuses = report.statuses.map((item) => ({
    ...item,
    count: 0,
    sharePercent: 0,
  }));
  return report;
}

const fixtureQuery = { from: "2026-08-10", to: "2026-08-11" };

test("valid mixed-status aggregate preserves decimal strings and buckets", () => {
  const report = parseBusinessReportRpcResult(
    validRpcReport(),
    fixtureQuery,
  );
  assert.equal(report.kpis.completedSales, "300.00");
  assert.equal(report.kpis.averageOrderValue, "150.00");
  assert.equal(report.kpis.soldItemQuantity, 3);
  assert.deepEqual(report.payments.map(({ method }) => method), [
    "cash",
    "card",
    "unknown",
  ]);
  assert.deepEqual(report.orderTypes.map(({ label }) => label), [
    "Teslimat",
    "Gel-al",
  ]);
});

test("empty report has null average and zero-filled days", () => {
  const report = parseBusinessReportRpcResult(
    emptyRpcReport(fixtureQuery),
    fixtureQuery,
  );
  assert.equal(report.kpis.averageOrderValue, null);
  assert.equal(report.daily.length, 2);
  assert.ok(report.daily.every(({ totalOrders }) => totalOrders === 0));
});

test("cancelled-only report is excluded from sales and sold items", () => {
  const raw = emptyRpcReport(fixtureQuery);
  raw.kpis.totalOrders = 1;
  raw.kpis.cancelledOrders = 1;
  raw.daily[0].totalOrders = 1;
  raw.statuses[4] = { status: "cancelled", count: 1, sharePercent: 100 };
  const report = parseBusinessReportRpcResult(raw, fixtureQuery);
  assert.equal(report.kpis.completedSales, "0.00");
  assert.equal(report.kpis.soldItemQuantity, 0);
  assert.equal(report.kpis.averageOrderValue, null);
});

test("numeric money values are rejected instead of losing precision", () => {
  const raw = validRpcReport();
  raw.kpis.completedSales = 300 as unknown as string;
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("daily series cannot omit an empty calendar day", () => {
  const raw = validRpcReport();
  raw.daily.splice(0, 1);
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("average must be null exactly when there are no delivered orders", () => {
  const raw = emptyRpcReport(fixtureQuery);
  raw.kpis.averageOrderValue = "0.00";
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("product quantities must reconcile with sold item KPI", () => {
  const raw = validRpcReport();
  raw.products[0].quantity = 5;
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("product response must keep revenue-first deterministic ordering", () => {
  const raw = validRpcReport();
  raw.products.reverse();
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("distinct legacy SHA-256 keys avoid accidental fallback collision", () => {
  const raw = validRpcReport();
  raw.products[1].key = `legacy:${"b".repeat(64)}`;
  assert.doesNotThrow(() =>
    parseBusinessReportRpcResult(raw, fixtureQuery),
  );
  raw.products.push({
    ...raw.products[1],
    quantity: 0,
    orderCount: 0,
    revenue: "0.00",
    sharePercent: 0,
  });
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("unexpected PII field causes fail-closed RPC validation", () => {
  const raw = validRpcReport() as ReturnType<typeof validRpcReport> & {
    customer_name?: string;
  };
  raw.customer_name = "PII must not pass";
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("RPC period must match the server-validated request", () => {
  const raw = validRpcReport();
  raw.period.from = "2026-08-09";
  assert.throws(
    () => parseBusinessReportRpcResult(raw, fixtureQuery),
    BusinessReportRpcValidationError,
  );
});

test("RPC scalar wrapped in a one-row PostgREST array is supported", () => {
  assert.equal(
    parseBusinessReportRpcResult([validRpcReport()], fixtureQuery).schemaVersion,
    1,
  );
});
