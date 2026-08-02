export type BusinessDashboardSummary = {
  date: string;
  timezone: "Europe/Istanbul";
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

export type BusinessDashboardSummaryErrorResponse = {
  error: string;
  code:
    | "UNAUTHORIZED"
    | "INVALID_DATE"
    | "DATE_OUT_OF_RANGE"
    | "BUSINESS_NOT_FOUND"
    | "BUSINESS_ACCOUNT_INVALID"
    | "SUMMARY_UNAVAILABLE";
};

export const businessDashboardSummaryErrorMessage =
  "Günlük özet yüklenemedi.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBusinessDashboardSummary(
  value: unknown,
): value is BusinessDashboardSummary {
  if (!isRecord(value) || !isRecord(value.range)) return false;
  if (!isRecord(value.orders) || !isRecord(value.revenue)) return false;

  return (
    typeof value.date === "string" &&
    value.timezone === "Europe/Istanbul" &&
    typeof value.range.start === "string" &&
    typeof value.range.endExclusive === "string" &&
    isNonNegativeInteger(value.orders.total) &&
    isNonNegativeInteger(value.orders.new) &&
    isNonNegativeInteger(value.orders.pending) &&
    isNonNegativeInteger(value.orders.delivered) &&
    isNonNegativeInteger(value.orders.cancelled) &&
    isNonNegativeNumber(value.revenue.delivered) &&
    value.revenue.currency === "TRY"
  );
}

export async function fetchBusinessDashboardSummary(
  accessToken: string,
  date?: string,
): Promise<BusinessDashboardSummary> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);

  try {
    const response = await fetch(
      `/api/business/dashboard-summary${
        params.toString() ? `?${params.toString()}` : ""
      }`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(businessDashboardSummaryErrorMessage);
    }

    const body: unknown = await response.json();
    if (!isBusinessDashboardSummary(body)) {
      throw new Error(businessDashboardSummaryErrorMessage);
    }

    return body;
  } catch {
    throw new Error(businessDashboardSummaryErrorMessage);
  }
}
