import type { Business } from "../businesses";

export const ADMIN_BUSINESS_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_BUSINESS_MAX_PAGE_SIZE = 50;
export const ADMIN_BUSINESS_SEARCH_MAX_LENGTH = 100;

export const ADMIN_BUSINESS_LIST_SELECT = [
  "id",
  "owner_id",
  "slug",
  "name",
  "description",
  "whatsapp_order_number",
  "created_at",
  "category",
  "city",
  "district",
  "neighborhood",
  "address",
  "delivery_status",
  "logo_text",
  "subscription_status",
  "subscription_started_at",
  "subscription_expires_at",
  "is_active",
].join(",");

export type AdminBusinessAccessFilter = "all" | "active" | "passive";
export type AdminBusinessSubscriptionFilter =
  | "all"
  | "active"
  | "expired"
  | "passive"
  | "blocked"
  | "ending7"
  | "ending30";
export type AdminBusinessCreatedFilter = "all" | "last7";
export type AdminBusinessSort = "newest" | "name_asc";

export type AdminBusinessListQuery = {
  q: string;
  page: number;
  pageSize: number;
  access: AdminBusinessAccessFilter;
  subscription: AdminBusinessSubscriptionFilter;
  created: AdminBusinessCreatedFilter;
  sort: AdminBusinessSort;
  city: string;
  district: string;
};

export type AdminBusinessListItem = Pick<
  Business,
  | "id"
  | "slug"
  | "name"
  | "description"
  | "whatsappOrderNumber"
  | "email"
  | "createdAt"
  | "category"
  | "city"
  | "district"
  | "neighborhood"
  | "address"
  | "deliveryStatus"
  | "logoText"
  | "subscriptionStatus"
  | "subscriptionStartedAt"
  | "subscriptionExpiresAt"
  | "isActive"
>;

export type AdminBusinessPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AdminBusinessListResponse = {
  items: AdminBusinessListItem[];
  pagination: AdminBusinessPagination;
};

const ACCESS_VALUES = new Set<AdminBusinessAccessFilter>([
  "all",
  "active",
  "passive",
]);
const SUBSCRIPTION_VALUES = new Set<AdminBusinessSubscriptionFilter>([
  "all",
  "active",
  "expired",
  "passive",
  "blocked",
  "ending7",
  "ending30",
]);
const CREATED_VALUES = new Set<AdminBusinessCreatedFilter>(["all", "last7"]);
const SORT_VALUES = new Set<AdminBusinessSort>(["newest", "name_asc"]);
const KNOWN_QUERY_PARAMETERS = new Set([
  "q",
  "page",
  "pageSize",
  "access",
  "subscription",
  "created",
  "sort",
  "city",
  "district",
]);
const LOCATION_FILTER_MAX_LENGTH = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AdminBusinessQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminBusinessQueryError";
  }
}

function readSingleParameter(
  searchParams: URLSearchParams,
  name: string,
): string | null {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    throw new AdminBusinessQueryError(`${name} parametresi yalnız bir kez kullanılabilir.`);
  }
  return values[0] ?? null;
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  name: string,
  maximum?: number,
) {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new AdminBusinessQueryError(`${name} pozitif bir tam sayı olmalıdır.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (maximum !== undefined && parsed > maximum)) {
    throw new AdminBusinessQueryError(`${name} geçerli aralığın dışındadır.`);
  }
  return parsed;
}

function parseEnum<T extends string>(
  value: string | null,
  fallback: T,
  allowed: ReadonlySet<T>,
  name: string,
) {
  if (value === null) return fallback;
  if (!allowed.has(value as T)) {
    throw new AdminBusinessQueryError(`${name} değeri desteklenmiyor.`);
  }
  return value as T;
}

function parseTextFilter(value: string | null, name: string, maximum: number) {
  const normalized = value?.trim() ?? "";
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new AdminBusinessQueryError(`${name} değeri geçerli değil.`);
  }
  return normalized;
}

export function parseAdminBusinessListQuery(
  searchParams: URLSearchParams,
): AdminBusinessListQuery {
  for (const name of searchParams.keys()) {
    if (!KNOWN_QUERY_PARAMETERS.has(name)) {
      throw new AdminBusinessQueryError(`Desteklenmeyen sorgu parametresi: ${name}`);
    }
  }

  return {
    q: parseTextFilter(
      readSingleParameter(searchParams, "q"),
      "q",
      ADMIN_BUSINESS_SEARCH_MAX_LENGTH,
    ),
    page: parsePositiveInteger(
      readSingleParameter(searchParams, "page"),
      1,
      "page",
    ),
    pageSize: parsePositiveInteger(
      readSingleParameter(searchParams, "pageSize"),
      ADMIN_BUSINESS_DEFAULT_PAGE_SIZE,
      "pageSize",
      ADMIN_BUSINESS_MAX_PAGE_SIZE,
    ),
    access: parseEnum(
      readSingleParameter(searchParams, "access"),
      "all",
      ACCESS_VALUES,
      "access",
    ),
    subscription: parseEnum(
      readSingleParameter(searchParams, "subscription"),
      "all",
      SUBSCRIPTION_VALUES,
      "subscription",
    ),
    created: parseEnum(
      readSingleParameter(searchParams, "created"),
      "all",
      CREATED_VALUES,
      "created",
    ),
    sort: parseEnum(
      readSingleParameter(searchParams, "sort"),
      "newest",
      SORT_VALUES,
      "sort",
    ),
    city: parseTextFilter(
      readSingleParameter(searchParams, "city"),
      "city",
      LOCATION_FILTER_MAX_LENGTH,
    ),
    district: parseTextFilter(
      readSingleParameter(searchParams, "district"),
      "district",
      LOCATION_FILTER_MAX_LENGTH,
    ),
  };
}

export function getAdminBusinessRange(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function getAdminBusinessTotalPages(total: number, pageSize: number) {
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}

function escapePostgresLikeLiteral(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll("*", "\\*");
}

export function quotePostgrestLikePattern(value: string) {
  const pattern = `*${escapePostgresLikeLiteral(value)}*`;
  return `"${pattern.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function addSearchFilter(
  params: URLSearchParams,
  q: string,
  ownerIds: readonly string[],
) {
  if (!q) return;

  const pattern = quotePostgrestLikePattern(q);
  const clauses = [
    "name",
    "slug",
    "whatsapp_order_number",
    "city",
    "district",
    "neighborhood",
    "address",
  ].map((column) => `${column}.ilike.${pattern}`);
  const safeOwnerIds = ownerIds.filter((id) => UUID_PATTERN.test(id));
  if (safeOwnerIds.length > 0) {
    clauses.push(`owner_id.in.(${safeOwnerIds.join(",")})`);
  }
  params.set("or", `(${clauses.join(",")})`);
}

function addSubscriptionFilter(
  params: URLSearchParams,
  value: AdminBusinessSubscriptionFilter,
  now: Date,
) {
  const nowIso = now.toISOString();
  if (value === "active") {
    params.append("is_active", "eq.true");
    params.append("subscription_status", "eq.active");
    params.append("subscription_expires_at", `gt.${nowIso}`);
  } else if (value === "expired") {
    params.set(
      "and",
      `(subscription_status.neq.blocked,or(subscription_expires_at.is.null,subscription_expires_at.lte.${nowIso}))`,
    );
  } else if (value === "passive") {
    params.append("is_active", "eq.false");
    params.append("subscription_status", "neq.blocked");
  } else if (value === "blocked") {
    params.append("subscription_status", "eq.blocked");
  } else if (value === "ending7" || value === "ending30") {
    const days = value === "ending7" ? 7 : 30;
    const upperBound = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    params.append("is_active", "eq.true");
    params.append("subscription_status", "eq.active");
    params.append("subscription_expires_at", `gt.${nowIso}`);
    params.append("subscription_expires_at", `lte.${upperBound.toISOString()}`);
  }
}

export function buildAdminBusinessRestParams(
  query: AdminBusinessListQuery,
  ownerIds: readonly string[],
  now = new Date(),
) {
  const params = new URLSearchParams();
  params.set("select", ADMIN_BUSINESS_LIST_SELECT);
  params.set(
    "order",
    query.sort === "name_asc" ? "name.asc,id.asc" : "created_at.desc,id.desc",
  );

  addSearchFilter(params, query.q, ownerIds);

  if (query.access === "active") params.set("is_active", "eq.true");
  if (query.access === "passive") params.set("is_active", "eq.false");
  addSubscriptionFilter(params, query.subscription, now);

  if (query.created === "last7") {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    params.set("created_at", `gte.${sevenDaysAgo.toISOString()}`);
    params.append("created_at", `lte.${now.toISOString()}`);
  }
  if (query.city) params.set("city", `eq.${query.city}`);
  if (query.district) params.set("district", `eq.${query.district}`);

  return params;
}

export function buildOwnerEmailSearchParams(q: string) {
  const params = new URLSearchParams();
  params.set("select", "id");
  params.set("email", `ilike.${quotePostgrestLikePattern(q)}`);
  params.set("order", "id.asc");
  return params;
}

export function parsePostgrestTotal(contentRange: string | null) {
  const match = contentRange?.match(/\/(\d+)$/);
  if (!match) throw new AdminBusinessQueryError("Toplam kayıt sayısı alınamadı.");
  return Number(match[1]);
}
