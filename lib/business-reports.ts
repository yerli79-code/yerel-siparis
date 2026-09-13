export const BUSINESS_REPORT_TIMEZONE = "Europe/Istanbul" as const;
export const BUSINESS_REPORT_CURRENCY = "TRY" as const;
export const BUSINESS_REPORT_SCHEMA_VERSION = 1 as const;
export const BUSINESS_REPORT_MAX_DAYS = 180;

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decimalPattern = /^(?:0|[1-9]\d*)\.\d{2}$/;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

export type BusinessReportQuery = {
  from: string;
  to: string;
};

export type BusinessReportRequestErrorCode =
  | "INVALID_QUERY"
  | "INVALID_DATE"
  | "DATE_OUT_OF_RANGE";

export class BusinessReportRequestError extends Error {
  readonly code: BusinessReportRequestErrorCode;

  constructor(code: BusinessReportRequestErrorCode) {
    super("Rapor tarih araligi gecersiz.");
    this.name = "BusinessReportRequestError";
    this.code = code;
  }
}

export class BusinessReportRpcValidationError extends Error {
  constructor() {
    super("Rapor RPC sonucu gecersiz.");
    this.name = "BusinessReportRpcValidationError";
  }
}

export type BusinessReport = {
  schemaVersion: typeof BUSINESS_REPORT_SCHEMA_VERSION;
  business: {
    name: string;
  };
  period: {
    from: string;
    to: string;
    timezone: typeof BUSINESS_REPORT_TIMEZONE;
    rangeStart: string;
    rangeEndExclusive: string;
    generatedAt: string;
  };
  currency: typeof BUSINESS_REPORT_CURRENCY;
  kpis: {
    totalOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    completedSales: string;
    averageOrderValue: string | null;
    soldItemQuantity: number;
  };
  daily: Array<{
    date: string;
    totalOrders: number;
    completedOrders: number;
    completedSales: string;
  }>;
  products: Array<{
    key: string;
    productId: string | null;
    name: string;
    quantity: number;
    orderCount: number;
    revenue: string;
    sharePercent: number;
  }>;
  payments: Array<{
    method: "cash" | "card" | "unknown";
    label: "Nakit" | "Kart" | "Belirtilmemiş";
    orderCount: number;
    revenue: string;
    sharePercent: number;
  }>;
  orderTypes: Array<{
    type: "delivery" | "pickup";
    label: "Teslimat" | "Gel-al";
    orderCount: number;
    revenue: string;
    sharePercent: number;
  }>;
  statuses: Array<{
    status: "new" | "preparing" | "ready" | "delivered" | "cancelled";
    count: number;
    sharePercent: number;
  }>;
};

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function parseCalendarDate(value: string): CalendarDate | null {
  const match = datePattern.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999) return null;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function formatCalendarDate(date: CalendarDate) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(
    2,
    "0",
  )}-${String(date.day).padStart(2, "0")}`;
}

export function getCalendarDaySerial(value: string) {
  const date = parseCalendarDate(value);
  if (!date) return null;

  const utcDate = new Date(0);
  utcDate.setUTCHours(0, 0, 0, 0);
  utcDate.setUTCFullYear(date.year, date.month - 1, date.day);
  return Math.trunc(utcDate.getTime() / millisecondsPerDay);
}

export function addCalendarDays(value: string, days: number) {
  const date = parseCalendarDate(value);
  if (!date || !Number.isSafeInteger(days)) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }

  const next = new Date(0);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCFullYear(date.year, date.month - 1, date.day + days);
  return formatCalendarDate({
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  });
}

export function getIstanbulCalendarDate(now: Date) {
  if (!Number.isFinite(now.getTime())) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  if (!year || !month || !day) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }

  const value = `${year}-${month}-${day}`;
  if (getCalendarDaySerial(value) === null) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }

  return value;
}

const istanbulDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_REPORT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getIstanbulOffset(timestamp: number) {
  const parts = istanbulDateTimeFormatter.formatToParts(new Date(timestamp));
  const values = new Map(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const representedAsUtc = Date.UTC(
    values.get("year") ?? Number.NaN,
    (values.get("month") ?? Number.NaN) - 1,
    values.get("day") ?? Number.NaN,
    values.get("hour") ?? Number.NaN,
    values.get("minute") ?? Number.NaN,
    values.get("second") ?? Number.NaN,
  );

  if (!Number.isFinite(representedAsUtc)) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }

  return representedAsUtc - timestamp;
}

export function getIstanbulDayStartIso(value: string) {
  const date = parseCalendarDate(value);
  if (!date) throw new BusinessReportRequestError("INVALID_DATE");

  const localMidnight = new Date(0);
  localMidnight.setUTCHours(0, 0, 0, 0);
  localMidnight.setUTCFullYear(date.year, date.month - 1, date.day);
  const localMidnightTimestamp = localMidnight.getTime();
  let timestamp =
    localMidnightTimestamp - getIstanbulOffset(localMidnightTimestamp);
  timestamp = localMidnightTimestamp - getIstanbulOffset(timestamp);

  return new Date(timestamp).toISOString();
}

export function getBusinessReportRangeBoundaries(query: BusinessReportQuery) {
  return {
    rangeStart: getIstanbulDayStartIso(query.from),
    rangeEndExclusive: getIstanbulDayStartIso(addCalendarDays(query.to, 1)),
  };
}

export function parseBusinessReportQuery(
  searchParams: URLSearchParams,
  now = new Date(),
): BusinessReportQuery {
  const allowed = new Set(["from", "to"]);
  const seen = new Set<string>();

  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) {
      throw new BusinessReportRequestError("INVALID_QUERY");
    }
    seen.add(key);
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from === null || to === null) {
    throw new BusinessReportRequestError("INVALID_QUERY");
  }

  const fromSerial = getCalendarDaySerial(from);
  const toSerial = getCalendarDaySerial(to);
  if (fromSerial === null || toSerial === null) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }
  if (fromSerial > toSerial) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }

  const inclusiveDayCount = toSerial - fromSerial + 1;
  if (inclusiveDayCount > BUSINESS_REPORT_MAX_DAYS) {
    throw new BusinessReportRequestError("DATE_OUT_OF_RANGE");
  }

  const todaySerial = getCalendarDaySerial(getIstanbulCalendarDate(now));
  if (todaySerial === null) {
    throw new BusinessReportRequestError("INVALID_DATE");
  }
  if (
    toSerial > todaySerial ||
    fromSerial < todaySerial - (BUSINESS_REPORT_MAX_DAYS - 1)
  ) {
    throw new BusinessReportRequestError("DATE_OUT_OF_RANGE");
  }

  return { from, to };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
}

function invalidRpcResult(): never {
  throw new BusinessReportRpcValidationError();
}

function readRecord(value: unknown, keys: string[]) {
  if (!isRecord(value) || !hasExactKeys(value, keys)) return invalidRpcResult();
  return value;
}

function readNonEmptyString(value: unknown, maxLength = 500) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    return invalidRpcResult();
  }
  return value;
}

function readNonNegativeInteger(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return invalidRpcResult();
  }
  return value;
}

function readDecimal(value: unknown) {
  if (typeof value !== "string" || !decimalPattern.test(value)) {
    return invalidRpcResult();
  }
  return value;
}

function readSharePercent(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    return invalidRpcResult();
  }
  return value;
}

function readIsoTimestamp(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    return invalidRpcResult();
  }
  return new Date(value).toISOString();
}

function safeIntegerSum(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) return invalidRpcResult();
  return total;
}

function decimalMinorUnits(value: string) {
  return BigInt(value.replace(".", ""));
}

export function parseBusinessReportRpcResult(
  body: unknown,
  expectedQuery: BusinessReportQuery,
): BusinessReport {
  const unwrapped =
    Array.isArray(body) && body.length === 1 && isRecord(body[0])
      ? body[0]
      : body;
  const root = readRecord(unwrapped, [
    "schemaVersion",
    "business",
    "period",
    "currency",
    "kpis",
    "daily",
    "products",
    "payments",
    "orderTypes",
    "statuses",
  ]);

  if (root.schemaVersion !== BUSINESS_REPORT_SCHEMA_VERSION) invalidRpcResult();
  if (root.currency !== BUSINESS_REPORT_CURRENCY) invalidRpcResult();

  const businessRow = readRecord(root.business, ["name"]);
  const business = { name: readNonEmptyString(businessRow.name, 240) };

  const periodRow = readRecord(root.period, [
    "from",
    "to",
    "timezone",
    "rangeStart",
    "rangeEndExclusive",
    "generatedAt",
  ]);
  if (
    periodRow.from !== expectedQuery.from ||
    periodRow.to !== expectedQuery.to ||
    periodRow.timezone !== BUSINESS_REPORT_TIMEZONE
  ) {
    invalidRpcResult();
  }
  const expectedBounds = getBusinessReportRangeBoundaries(expectedQuery);
  const rangeStart = readIsoTimestamp(periodRow.rangeStart);
  const rangeEndExclusive = readIsoTimestamp(periodRow.rangeEndExclusive);
  if (
    rangeStart !== expectedBounds.rangeStart ||
    rangeEndExclusive !== expectedBounds.rangeEndExclusive
  ) {
    invalidRpcResult();
  }
  const period = {
    from: expectedQuery.from,
    to: expectedQuery.to,
    timezone: BUSINESS_REPORT_TIMEZONE,
    rangeStart,
    rangeEndExclusive,
    generatedAt: readIsoTimestamp(periodRow.generatedAt),
  };

  const kpiRow = readRecord(root.kpis, [
    "totalOrders",
    "completedOrders",
    "cancelledOrders",
    "completedSales",
    "averageOrderValue",
    "soldItemQuantity",
  ]);
  const completedOrders = readNonNegativeInteger(kpiRow.completedOrders);
  const averageOrderValue =
    kpiRow.averageOrderValue === null
      ? null
      : readDecimal(kpiRow.averageOrderValue);
  if (
    (completedOrders === 0 && averageOrderValue !== null) ||
    (completedOrders > 0 && averageOrderValue === null)
  ) {
    invalidRpcResult();
  }
  const kpis = {
    totalOrders: readNonNegativeInteger(kpiRow.totalOrders),
    completedOrders,
    cancelledOrders: readNonNegativeInteger(kpiRow.cancelledOrders),
    completedSales: readDecimal(kpiRow.completedSales),
    averageOrderValue,
    soldItemQuantity: readNonNegativeInteger(kpiRow.soldItemQuantity),
  };
  if (kpis.completedOrders + kpis.cancelledOrders > kpis.totalOrders) {
    invalidRpcResult();
  }

  if (!Array.isArray(root.daily)) invalidRpcResult();
  const fromSerial = getCalendarDaySerial(expectedQuery.from);
  const toSerial = getCalendarDaySerial(expectedQuery.to);
  if (fromSerial === null || toSerial === null) invalidRpcResult();
  const expectedDayCount = toSerial - fromSerial + 1;
  if (root.daily.length !== expectedDayCount) invalidRpcResult();
  const daily = root.daily.map((value, index) => {
    const row = readRecord(value, [
      "date",
      "totalOrders",
      "completedOrders",
      "completedSales",
    ]);
    if (row.date !== addCalendarDays(expectedQuery.from, index)) {
      invalidRpcResult();
    }
    const item = {
      date: row.date,
      totalOrders: readNonNegativeInteger(row.totalOrders),
      completedOrders: readNonNegativeInteger(row.completedOrders),
      completedSales: readDecimal(row.completedSales),
    };
    if (item.completedOrders > item.totalOrders) invalidRpcResult();
    return item;
  });

  if (!Array.isArray(root.products)) invalidRpcResult();
  const productKeys = new Set<string>();
  const products = root.products.map((value) => {
    const row = readRecord(value, [
      "key",
      "productId",
      "name",
      "quantity",
      "orderCount",
      "revenue",
      "sharePercent",
    ]);
    const key = readNonEmptyString(row.key, 100);
    const productId = row.productId;
    if (
      (productId !== null &&
        (typeof productId !== "string" ||
          !uuidPattern.test(productId) ||
          key !== `product:${productId.toLowerCase()}`)) ||
      (productId === null && !/^legacy:[0-9a-f]{64}$/.test(key)) ||
      productKeys.has(key)
    ) {
      invalidRpcResult();
    }
    productKeys.add(key);
    return {
      key,
      productId,
      name: readNonEmptyString(row.name, 180),
      quantity: readNonNegativeInteger(row.quantity),
      orderCount: readNonNegativeInteger(row.orderCount),
      revenue: readDecimal(row.revenue),
      sharePercent: readSharePercent(row.sharePercent),
    };
  });
  for (let index = 1; index < products.length; index += 1) {
    const previous = products[index - 1];
    const current = products[index];
    const previousRevenue = decimalMinorUnits(previous.revenue);
    const currentRevenue = decimalMinorUnits(current.revenue);
    if (
      previousRevenue < currentRevenue ||
      (previousRevenue === currentRevenue &&
        (previous.quantity < current.quantity ||
          (previous.quantity === current.quantity &&
            previous.key >= current.key)))
    ) {
      invalidRpcResult();
    }
  }

  const paymentDefinitions = [
    ["cash", "Nakit"],
    ["card", "Kart"],
    ["unknown", "Belirtilmemiş"],
  ] as const;
  if (!Array.isArray(root.payments) || root.payments.length !== 3) {
    invalidRpcResult();
  }
  const payments = root.payments.map((value, index) => {
    const row = readRecord(value, [
      "method",
      "label",
      "orderCount",
      "revenue",
      "sharePercent",
    ]);
    const [method, label] = paymentDefinitions[index];
    if (row.method !== method || row.label !== label) invalidRpcResult();
    return {
      method,
      label,
      orderCount: readNonNegativeInteger(row.orderCount),
      revenue: readDecimal(row.revenue),
      sharePercent: readSharePercent(row.sharePercent),
    };
  });

  const orderTypeDefinitions = [
    ["delivery", "Teslimat"],
    ["pickup", "Gel-al"],
  ] as const;
  if (!Array.isArray(root.orderTypes) || root.orderTypes.length !== 2) {
    invalidRpcResult();
  }
  const orderTypes = root.orderTypes.map((value, index) => {
    const row = readRecord(value, [
      "type",
      "label",
      "orderCount",
      "revenue",
      "sharePercent",
    ]);
    const [type, label] = orderTypeDefinitions[index];
    if (row.type !== type || row.label !== label) invalidRpcResult();
    return {
      type,
      label,
      orderCount: readNonNegativeInteger(row.orderCount),
      revenue: readDecimal(row.revenue),
      sharePercent: readSharePercent(row.sharePercent),
    };
  });

  const statusDefinitions = [
    "new",
    "preparing",
    "ready",
    "delivered",
    "cancelled",
  ] as const;
  if (!Array.isArray(root.statuses) || root.statuses.length !== 5) {
    invalidRpcResult();
  }
  const statuses = root.statuses.map((value, index) => {
    const row = readRecord(value, ["status", "count", "sharePercent"]);
    const status = statusDefinitions[index];
    if (row.status !== status) invalidRpcResult();
    return {
      status,
      count: readNonNegativeInteger(row.count),
      sharePercent: readSharePercent(row.sharePercent),
    };
  });

  if (
    safeIntegerSum(daily.map((item) => item.totalOrders)) !==
      kpis.totalOrders ||
    safeIntegerSum(daily.map((item) => item.completedOrders)) !==
      kpis.completedOrders ||
    safeIntegerSum(products.map((item) => item.quantity)) !==
      kpis.soldItemQuantity ||
    safeIntegerSum(payments.map((item) => item.orderCount)) !==
      kpis.completedOrders ||
    safeIntegerSum(orderTypes.map((item) => item.orderCount)) !==
      kpis.completedOrders ||
    safeIntegerSum(statuses.map((item) => item.count)) !== kpis.totalOrders ||
    statuses[3].count !== kpis.completedOrders ||
    statuses[4].count !== kpis.cancelledOrders
  ) {
    invalidRpcResult();
  }

  return {
    schemaVersion: BUSINESS_REPORT_SCHEMA_VERSION,
    business,
    period,
    currency: BUSINESS_REPORT_CURRENCY,
    kpis,
    daily,
    products,
    payments,
    orderTypes,
    statuses,
  };
}
