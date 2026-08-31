import { privateBusinessJson } from "../_response";
import {
  fetchBusinessesForUser,
  getBearerToken,
  getSupabaseServerConfig,
  getUserFromToken,
  isPlainObject,
  readJson,
} from "../orders/_utils";

const dashboardTimezone = "Europe/Istanbul" as const;
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const millisecondsPerDay = 24 * 60 * 60 * 1000;
const allowedPastCalendarDays = 179;

type BusinessDashboardSummaryResponse = {
  date: string;
  timezone: typeof dashboardTimezone;
  range: {
    start: string;
    endExclusive: string;
  };
  orders: {
    total: number;
    new: number;
    pending: number;
    delivered: number;
    cancelled: number;
  };
  revenue: {
    delivered: number;
    currency: "TRY";
  };
};

type BusinessDashboardSummaryErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_DATE"
  | "DATE_OUT_OF_RANGE"
  | "BUSINESS_NOT_FOUND"
  | "BUSINESS_ACCOUNT_INVALID"
  | "SUMMARY_UNAVAILABLE";

type BusinessDashboardSummaryErrorResponse = {
  error: string;
  code: BusinessDashboardSummaryErrorCode;
};

type ParsedRpcSummary = {
  rangeStart: string;
  rangeEndExclusive: string;
  totalOrders: number;
  newOrders: number;
  pendingOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  allCurrencyTry: boolean;
  deliveredRevenue: number;
};

function summaryError(
  error: string,
  code: BusinessDashboardSummaryErrorCode,
  status: number,
) {
  const body: BusinessDashboardSummaryErrorResponse = { error, code };
  return privateBusinessJson(body, status);
}

function getUtcCalendarDaySerial(value: string) {
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

  return Math.trunc(date.getTime() / millisecondsPerDay);
}

function getIstanbulToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: dashboardTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  if (!year || !month || !day) {
    throw new Error("Istanbul tarihi belirlenemedi.");
  }

  const value = `${year}-${month}-${day}`;
  const serial = getUtcCalendarDaySerial(value);
  if (serial === null) {
    throw new Error("Istanbul tarihi dogrulanamadi.");
  }

  return { value, serial };
}

function readNonNegativeInteger(value: unknown) {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readNonNegativeNumber(value: unknown) {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readIsoTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function parseRpcSummary(body: unknown): ParsedRpcSummary | null {
  if (!Array.isArray(body) || body.length !== 1 || !isPlainObject(body[0])) {
    return null;
  }

  const row = body[0];
  const rangeStart = readIsoTimestamp(row.range_start);
  const rangeEndExclusive = readIsoTimestamp(row.range_end_exclusive);
  const totalOrders = readNonNegativeInteger(row.total_orders);
  const newOrders = readNonNegativeInteger(row.new_orders);
  const pendingOrders = readNonNegativeInteger(row.pending_orders);
  const deliveredOrders = readNonNegativeInteger(row.delivered_orders);
  const cancelledOrders = readNonNegativeInteger(row.cancelled_orders);
  const allCurrencyTry =
    typeof row.all_currency_try === "boolean" ? row.all_currency_try : null;
  const deliveredRevenue = readNonNegativeNumber(row.delivered_revenue);

  if (
    !rangeStart ||
    !rangeEndExclusive ||
    totalOrders === null ||
    newOrders === null ||
    pendingOrders === null ||
    deliveredOrders === null ||
    cancelledOrders === null ||
    allCurrencyTry === null ||
    deliveredRevenue === null ||
    Date.parse(rangeStart) >= Date.parse(rangeEndExclusive) ||
    totalOrders !== pendingOrders + deliveredOrders + cancelledOrders ||
    newOrders > pendingOrders
  ) {
    return null;
  }

  return {
    rangeStart,
    rangeEndExclusive,
    totalOrders,
    newOrders,
    pendingOrders,
    deliveredOrders,
    cancelledOrders,
    allCurrencyTry,
    deliveredRevenue,
  };
}

export async function GET(request: Request) {
  let stage:
    | "config"
    | "auth"
    | "business_lookup"
    | "business_cardinality"
    | "date_validation"
    | "rpc"
    | "rpc_validation" = "config";

  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();

    stage = "auth";
    const accessToken = getBearerToken(request);
    if (!accessToken) {
      return summaryError("Oturum bulunamadi.", "UNAUTHORIZED", 401);
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return summaryError(
        "Gecersiz veya suresi dolmus oturum.",
        "UNAUTHORIZED",
        401,
      );
    }

    stage = "business_lookup";
    const businesses = await fetchBusinessesForUser(
      url,
      serviceRoleKey,
      user.id,
    );

    stage = "business_cardinality";
    if (businesses.length === 0) {
      return summaryError(
        "Giris yapan kullaniciya ait isletme bulunamadi.",
        "BUSINESS_NOT_FOUND",
        404,
      );
    }
    if (businesses.length > 1) {
      return summaryError(
        "Kullanici hesabi birden fazla isletmeyle eslesiyor.",
        "BUSINESS_ACCOUNT_INVALID",
        409,
      );
    }

    stage = "date_validation";
    const searchParams = new URL(request.url).searchParams;
    const dateValues = searchParams.getAll("date");
    const hasUnexpectedParameter = Array.from(searchParams.keys()).some(
      (key) => key !== "date",
    );
    if (hasUnexpectedParameter || dateValues.length > 1) {
      return summaryError(
        "Istek parametreleri gecersiz.",
        "INVALID_DATE",
        400,
      );
    }

    const today = getIstanbulToday();
    const selectedDate = dateValues.length === 0 ? today.value : dateValues[0];
    const selectedDateSerial = getUtcCalendarDaySerial(selectedDate);
    if (selectedDateSerial === null) {
      return summaryError("Tarih gecersiz.", "INVALID_DATE", 400);
    }
    if (
      selectedDateSerial > today.serial ||
      selectedDateSerial < today.serial - allowedPastCalendarDays
    ) {
      return summaryError(
        "Tarih izin verilen araligin disinda.",
        "DATE_OUT_OF_RANGE",
        422,
      );
    }

    stage = "rpc";
    const rpcResponse = await fetch(
      `${url}/rest/v1/rpc/get_business_dashboard_summary`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_business_id: businesses[0].id,
          p_date: selectedDate,
        }),
        cache: "no-store",
      },
    );
    const rpcBody = await readJson(rpcResponse);
    if (!rpcResponse.ok) {
      throw new Error("Dashboard summary RPC istegi basarisiz.");
    }

    stage = "rpc_validation";
    const summary = parseRpcSummary(rpcBody);
    if (!summary) {
      throw new Error("Dashboard summary RPC sonucu gecersiz.");
    }
    if (summary.allCurrencyTry !== true) {
      throw new Error("Dashboard summary para birimi gecersiz.");
    }

    const responseBody: BusinessDashboardSummaryResponse = {
      date: selectedDate,
      timezone: dashboardTimezone,
      range: {
        start: summary.rangeStart,
        endExclusive: summary.rangeEndExclusive,
      },
      orders: {
        total: summary.totalOrders,
        new: summary.newOrders,
        pending: summary.pendingOrders,
        delivered: summary.deliveredOrders,
        cancelled: summary.cancelledOrders,
      },
      revenue: {
        delivered: summary.deliveredRevenue,
        currency: "TRY",
      },
    };

    return privateBusinessJson(responseBody);
  } catch (error) {
    console.error("business_dashboard_summary_failed", {
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return summaryError(
      "Dashboard ozeti su anda alinamiyor.",
      "SUMMARY_UNAVAILABLE",
      500,
    );
  }
}
