import {
  fetchOrdersForBusiness,
  fetchOrderItemsForOrders,
  fetchBusinessesForUser,
  getBearerToken,
  getSingleUserBusiness,
  getSupabaseServerConfig,
  getUserFromToken,
  isOrderStatus,
  jsonError,
  mapOrder,
  type BusinessOrderQuery,
} from "./_utils";
import { parseOrderSearch } from "./search";

const allowedOrderQueryParams = new Set([
  "status",
  "search",
  "dateFrom",
  "dateTo",
  "page",
  "pageSize",
  "limit",
]);
const allowedOrderPageSizes = new Set([10, 20, 50]);

const istanbulDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

class InvalidOrderQueryError extends Error {
  constructor() {
    super("Siparis filtreleri gecersiz.");
    this.name = "InvalidOrderQueryError";
  }
}

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function parseCalendarDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new InvalidOrderQueryError();

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidOrderQueryError();
  }

  return { year, month, day };
}

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
    throw new Error("Istanbul tarih donusumu yapilamadi.");
  }

  return representedAsUtc - timestamp;
}

function getIstanbulDayStart(date: CalendarDate) {
  const localMidnight = Date.UTC(date.year, date.month - 1, date.day);
  let timestamp = localMidnight - getIstanbulOffset(localMidnight);
  timestamp = localMidnight - getIstanbulOffset(timestamp);

  return new Date(timestamp).toISOString();
}

function getNextCalendarDate(date: CalendarDate): CalendarDate {
  const nextDate = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
  };
}

function parsePositiveInteger(value: string | null, fallback: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new InvalidOrderQueryError();

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidOrderQueryError();
  }

  return parsed;
}

function parseOrderQuery(request: Request): BusinessOrderQuery {
  const searchParams = new URL(request.url).searchParams;

  for (const key of searchParams.keys()) {
    if (
      !allowedOrderQueryParams.has(key) ||
      searchParams.getAll(key).length !== 1
    ) {
      throw new InvalidOrderQueryError();
    }
  }

  const status = searchParams.get("status");
  if (status !== null && !isOrderStatus(status)) {
    throw new InvalidOrderQueryError();
  }

  const rawSearch = searchParams.get("search");
  const trimmedSearch = rawSearch?.trim() ?? "";
  if (trimmedSearch.length > 80) throw new InvalidOrderQueryError();
  const search = parseOrderSearch(trimmedSearch);

  const rawDateFrom = searchParams.get("dateFrom");
  const rawDateTo = searchParams.get("dateTo");
  const dateFrom = rawDateFrom === null ? null : parseCalendarDate(rawDateFrom);
  const dateTo = rawDateTo === null ? null : parseCalendarDate(rawDateTo);
  if (rawDateFrom && rawDateTo && rawDateFrom > rawDateTo) {
    throw new InvalidOrderQueryError();
  }

  const page = parsePositiveInteger(searchParams.get("page"), 1);
  const pageSizeParam = searchParams.get("pageSize");
  const legacyLimitParam = searchParams.get("limit");
  let requestedPageSize: number;
  if (pageSizeParam !== null) {
    requestedPageSize = parsePositiveInteger(pageSizeParam, 20);
    if (!allowedOrderPageSizes.has(requestedPageSize)) {
      throw new InvalidOrderQueryError();
    }
  } else {
    requestedPageSize = Math.min(
      parsePositiveInteger(legacyLimitParam, 20),
      100,
    );
  }
  if (!Number.isSafeInteger((page - 1) * requestedPageSize)) {
    throw new InvalidOrderQueryError();
  }

  return {
    status: status ?? undefined,
    search,
    dateFrom: dateFrom ? getIstanbulDayStart(dateFrom) : undefined,
    dateToExclusive: dateTo
      ? getIstanbulDayStart(getNextCalendarDate(dateTo))
      : undefined,
    page,
    pageSize: requestedPageSize,
  };
}

export async function fetchBusinessOrdersForUser(request: Request) {
  let stage:
    | "config"
    | "auth"
    | "query"
    | "business_lookup"
    | "business_cardinality"
    | "orders"
    | "order_items" = "config";

  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();

    stage = "auth";
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return { response: jsonError("Oturum bulunamadi veya gecersiz.", 401) };
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return { response: jsonError("Oturum bulunamadi veya gecersiz.", 401) };
    }

    stage = "query";
    let query: BusinessOrderQuery;
    try {
      query = parseOrderQuery(request);
    } catch (error) {
      if (error instanceof InvalidOrderQueryError) {
        return {
          response: jsonError(
            "Siparis filtreleri gecersiz.",
            400,
            "INVALID_QUERY",
          ),
        };
      }
      throw error;
    }

    stage = "business_lookup";
    const businesses = await fetchBusinessesForUser(
      url,
      serviceRoleKey,
      user.id,
    );

    stage = "business_cardinality";
    const business = getSingleUserBusiness(businesses);

    stage = "orders";
    const orderResult = await fetchOrdersForBusiness(
      url,
      serviceRoleKey,
      business.id,
      query,
    );

    stage = "order_items";
    const orderItems = await fetchOrderItemsForOrders(
      url,
      serviceRoleKey,
      orderResult.orders.map((order) => order.id),
    );
    const itemsByOrderId = new Map<string, typeof orderItems>();
    orderItems.forEach((item) => {
      itemsByOrderId.set(item.order_id, [
        ...(itemsByOrderId.get(item.order_id) ?? []),
        item,
      ]);
    });

    const totalPages = Math.max(
      1,
      Math.ceil(orderResult.total / query.pageSize),
    );

    return {
      orders: orderResult.orders.map((order) =>
        mapOrder(order, itemsByOrderId.get(order.id) ?? []),
      ),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: orderResult.total,
        totalPages,
        hasPreviousPage: query.page > 1,
        hasNextPage: query.page < totalPages,
      },
    };
  } catch (error) {
    console.error("business_orders_read_failed", {
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { response: jsonError("Siparisler alinamadi.", 500) };
  }
}
