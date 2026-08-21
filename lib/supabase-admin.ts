import type { Business } from "./businesses";
import { requestAdminApi } from "./admin-client";
import type {
  AdminBusinessListQuery,
  AdminBusinessListResponse,
} from "./admin/business-list-contract";
import type {
  AdminBusinessDetail,
  AdminBusinessSafePatch,
  AdminBusinessSafePatchResult,
} from "./admin/business-detail-contract";
import type {
  AdminBusinessCriticalDto,
  AdminBusinessExtensionDays,
} from "./admin/business-actions-contract";
import type { AdminKpis } from "./subscription";

export type SubscriptionUpdatePayload = {
  subscription_status: "active" | "expired" | "blocked";
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  is_active: boolean;
};

export type AdminCreateBusinessInput = {
  slug: string;
  name: string;
  description: string;
  whatsappOrderNumber: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  ownerEmail: string;
  temporaryPassword: string;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  isActive: boolean;
};

export type AdminUpdateBusinessInput = {
  id: string;
  slug: string;
  name: string;
  description: string;
  whatsappOrderNumber: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  isActive: boolean;
};

type SupabaseBusinessRow = {
  id?: string;
  owner_id?: string | null;
  slug: string;
  name?: string | null;
  description?: string | null;
  whatsapp_order_number?: string | null;
  email?: string | null;
  created_at?: string | null;
  category?: string | null;
  city?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  delivery_status?: string | null;
  logo_text?: string | null;
  subscription_status?: "active" | "expired" | "blocked" | null;
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
  is_active?: boolean | null;
};

function mergeSupabaseBusiness(
  row: SupabaseBusinessRow,
  fallback?: Business,
): Business {
  return {
    id: row.id ?? fallback?.id,
    slug: row.slug,
    name: row.name ?? fallback?.name ?? row.slug,
    description: row.description ?? fallback?.description ?? "",
    whatsappOrderNumber:
      row.whatsapp_order_number ?? fallback?.whatsappOrderNumber ?? "",
    email: row.email ?? fallback?.email ?? "",
    createdAt: row.created_at ?? fallback?.createdAt ?? new Date().toISOString(),
    category: row.category ?? fallback?.category ?? "",
    city: row.city ?? fallback?.city ?? "",
    district: row.district ?? fallback?.district ?? "",
    neighborhood: row.neighborhood ?? fallback?.neighborhood ?? "",
    address: row.address ?? fallback?.address ?? "",
    deliveryStatus: row.delivery_status ?? fallback?.deliveryStatus ?? "",
    logoText: row.logo_text ?? fallback?.logoText ?? "",
    subscriptionStatus:
      row.subscription_status ?? fallback?.subscriptionStatus ?? "expired",
    subscriptionStartedAt:
      row.subscription_started_at ?? fallback?.subscriptionStartedAt ?? null,
    subscriptionExpiresAt:
      row.subscription_expires_at ?? fallback?.subscriptionExpiresAt ?? null,
    isActive: row.is_active ?? fallback?.isActive ?? false,
    productCategories: fallback?.productCategories ?? [],
  };
}

function parseSupabaseBody(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class AdminBusinessRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AdminBusinessRequestError";
  }
}

function businessRequestError(response: Response, body: unknown, fallback: string) {
  const error = body && typeof body === "object" && "error" in body
    ? (body as { error?: { code?: unknown; message?: unknown } }).error
    : null;
  return new AdminBusinessRequestError(
    typeof error?.message === "string" ? error.message : fallback,
    response.status,
    typeof error?.code === "string" ? error.code : "ADMIN_UNAVAILABLE",
  );
}

export type AdminBusinessCriticalMutationResult = {
  business: AdminBusinessCriticalDto;
  auditAction: string;
};

const CRITICAL_RESPONSE_KEYS = new Set(["business", "auditAction"]);
const CRITICAL_BUSINESS_KEYS = new Set([
  "id",
  "isActive",
  "subscriptionStatus",
  "subscriptionStartedAt",
  "subscriptionExpiresAt",
  "updatedAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function parseAdminBusinessCriticalMutationResult(
  value: unknown,
  requestedBusinessId: string,
): AdminBusinessCriticalMutationResult | null {
  if (!isRecord(value) || !hasExactKeys(value, CRITICAL_RESPONSE_KEYS)) return null;
  if (!isRecord(value.business) || !hasExactKeys(value.business, CRITICAL_BUSINESS_KEYS)) {
    return null;
  }

  const business = value.business;
  if (
    business.id !== requestedBusinessId ||
    typeof business.isActive !== "boolean" ||
    (business.subscriptionStatus !== "active" &&
      business.subscriptionStatus !== "expired" &&
      business.subscriptionStatus !== "blocked") ||
    !isNullableTimestamp(business.subscriptionStartedAt) ||
    !isNullableTimestamp(business.subscriptionExpiresAt) ||
    !isTimestamp(business.updatedAt) ||
    typeof value.auditAction !== "string" ||
    !value.auditAction
  ) {
    return null;
  }

  return {
    business: {
      id: business.id,
      isActive: business.isActive,
      subscriptionStatus: business.subscriptionStatus,
      subscriptionStartedAt: business.subscriptionStartedAt,
      subscriptionExpiresAt: business.subscriptionExpiresAt,
      updatedAt: business.updatedAt,
    },
    auditAction: value.auditAction,
  };
}

async function requestAdminBusinessCriticalMutation(
  businessId: string,
  actionPath: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<AdminBusinessCriticalMutationResult> {
  const response = await requestAdminApi(
    `/api/admin/businesses/${encodeURIComponent(businessId)}/${actionPath}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const text = await response.text();
  const responseBody = parseSupabaseBody(text);
  if (!response.ok) {
    throw businessRequestError(
      response,
      responseBody,
      "Kritik işlem tamamlanamadı. Lütfen tekrar deneyin.",
    );
  }

  const result = parseAdminBusinessCriticalMutationResult(responseBody, businessId);
  if (!result) {
    throw new AdminBusinessRequestError(
      "Güncel işletme bilgisi alınamadı.",
      503,
      "ADMIN_UNAVAILABLE",
    );
  }
  return result;
}

export function mergeAdminBusinessCriticalState<T extends AdminBusinessCriticalDto>(
  current: T,
  authoritative: AdminBusinessCriticalDto,
): T {
  if (current.id !== authoritative.id) return current;
  return { ...current, ...authoritative };
}

export function deactivateAdminBusiness(
  businessId: string,
  expectedUpdatedAt: string,
) {
  return requestAdminBusinessCriticalMutation(businessId, "deactivate", "POST", {
    expectedUpdatedAt,
  });
}

export function reactivateAdminBusiness(
  businessId: string,
  expectedUpdatedAt: string,
) {
  return requestAdminBusinessCriticalMutation(businessId, "reactivate", "POST", {
    expectedUpdatedAt,
  });
}

export function blockAdminBusiness(
  businessId: string,
  expectedUpdatedAt: string,
) {
  return requestAdminBusinessCriticalMutation(businessId, "block", "POST", {
    expectedUpdatedAt,
  });
}

export function resetAdminBusinessSubscription(
  businessId: string,
  expectedUpdatedAt: string,
) {
  return requestAdminBusinessCriticalMutation(
    businessId,
    "reset-subscription",
    "POST",
    { expectedUpdatedAt },
  );
}

export function extendAdminBusinessSubscription(
  businessId: string,
  days: AdminBusinessExtensionDays,
  expectedUpdatedAt: string,
) {
  return requestAdminBusinessCriticalMutation(businessId, "subscription", "PATCH", {
    operation: "extend",
    days,
    expectedUpdatedAt,
  });
}

export function setAdminBusinessSubscriptionDate(
  businessId: string,
  expiresOn: string,
  expectedUpdatedAt: string,
) {
  return requestAdminBusinessCriticalMutation(businessId, "subscription", "PATCH", {
    operation: "setDate",
    expiresOn,
    expectedUpdatedAt,
  });
}

export async function fetchAdminBusinessDetail(
  businessId: string,
  signal?: AbortSignal,
): Promise<AdminBusinessDetail> {
  const response = await requestAdminApi(`/api/admin/businesses/${encodeURIComponent(businessId)}`, {
    method: "GET",
    signal,
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);
  if (!response.ok) {
    throw businessRequestError(response, body, "İşletme bilgileri yüklenemedi.");
  }
  if (!body?.business?.id || !body?.business?.updatedAt || !Array.isArray(body?.recentOrders)) {
    throw new AdminBusinessRequestError(
      "İşletme bilgileri yüklenemedi.",
      503,
      "ADMIN_UNAVAILABLE",
    );
  }
  return body as AdminBusinessDetail;
}

export async function updateAdminBusinessSafely(
  businessId: string,
  patch: AdminBusinessSafePatch,
): Promise<AdminBusinessSafePatchResult> {
  const response = await requestAdminApi(`/api/admin/businesses/${encodeURIComponent(businessId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);
  if (!response.ok) {
    throw businessRequestError(response, body, "İşletme kaydedilemedi.");
  }
  const business = body?.business as AdminBusinessSafePatchResult | undefined;
  if (!business?.id || !business.updatedAt) {
    throw new AdminBusinessRequestError(
      "Güncel işletme bilgisi alınamadı.",
      503,
      "ADMIN_UNAVAILABLE",
    );
  }
  return business;
}

function nullableDateKey(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function verifySubscriptionUpdate(
  row: SupabaseBusinessRow,
  payload: SubscriptionUpdatePayload,
) {
  const hasMismatch =
    row.subscription_status !== payload.subscription_status ||
    row.is_active !== payload.is_active ||
    nullableDateKey(row.subscription_started_at) !==
      nullableDateKey(payload.subscription_started_at) ||
    nullableDateKey(row.subscription_expires_at) !==
      nullableDateKey(payload.subscription_expires_at);

  if (hasMismatch) {
    throw new Error("Abonelik doğrulaması tamamlanamadı.");
  }
}

export async function fetchAdminBusinessPage(
  query: AdminBusinessListQuery,
  signal?: AbortSignal,
): Promise<AdminBusinessListResponse> {
  const searchParams = new URLSearchParams();
  if (query.q) searchParams.set("q", query.q);
  searchParams.set("page", String(query.page));
  searchParams.set("pageSize", String(query.pageSize));
  searchParams.set("access", query.access);
  searchParams.set("subscription", query.subscription);
  searchParams.set("created", query.created);
  searchParams.set("sort", query.sort);
  if (query.city) searchParams.set("city", query.city);
  if (query.district) searchParams.set("district", query.district);

  const response = await requestAdminApi(
    `/api/admin/list-businesses?${searchParams}`,
    {
    method: "GET",
      signal,
    },
  );

  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    throw new Error("Liste yüklenemedi. Lütfen tekrar deneyin.");
  }

  if (
    !body ||
    !Array.isArray(body.items) ||
    typeof body.pagination?.page !== "number" ||
    typeof body.pagination?.pageSize !== "number" ||
    typeof body.pagination?.total !== "number" ||
    typeof body.pagination?.totalPages !== "number"
  ) {
    throw new Error("Liste yüklenemedi. Lütfen tekrar deneyin.");
  }

  return body as AdminBusinessListResponse;
}

export async function fetchAdminOverview(signal?: AbortSignal): Promise<AdminKpis> {
  const response = await requestAdminApi("/api/admin/overview", {
    method: "GET",
    signal,
  });
  const text = await response.text();
  const body = parseSupabaseBody(text) as Partial<AdminKpis> | null;
  const keys: Array<keyof AdminKpis> = [
    "total",
    "active",
    "inactive",
    "createdLastSevenDays",
    "activeSubscriptions",
    "expiringSubscriptions",
  ];

  if (!response.ok || !body || keys.some((key) => typeof body[key] !== "number")) {
    throw new Error("Yönetim özeti yüklenemedi. Lütfen tekrar deneyin.");
  }

  return body as AdminKpis;
}

export async function createBusinessWithAccount(
  input: AdminCreateBusinessInput,
) {
  const response = await requestAdminApi("/api/admin/create-business", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    throw new Error("İşletme kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.");
  }

  const createdRow = body?.business as SupabaseBusinessRow | undefined;

  if (!createdRow?.slug) {
    throw new Error("Yeni işletme oluşturuldu ancak kayıt bilgisi dönmedi.");
  }

  return mergeSupabaseBusiness(createdRow);
}

export type DeleteBusinessResult = {
  deleted: boolean;
  notFound?: boolean;
  message?: string;
};

export async function deleteBusinessInSupabase(
  businessId: string,
): Promise<DeleteBusinessResult> {
  if (!businessId.trim()) {
    throw new Error("Silinecek işletme ID bilgisi eksik.");
  }

  const response = await requestAdminApi("/api/admin/delete-business", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ businessId }),
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    throw new Error("İşletme silinemedi. Lütfen tekrar deneyin.");
  }

  return {
    deleted: Boolean(body?.deleted),
    notFound: Boolean(body?.notFound),
    message: body?.message,
  };
}

export async function updateBusinessInSupabase(
  input: AdminUpdateBusinessInput,
) {
  if (!input.id.trim()) {
    throw new Error("Guncellenecek isletme ID bilgisi eksik.");
  }

  const response = await requestAdminApi("/api/admin/update-business", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    throw new Error("İşletme kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.");
  }

  const updatedRow = body?.business as SupabaseBusinessRow | undefined;
  if (!updatedRow?.slug) {
    throw new Error("Isletme guncellendi ancak kayit bilgisi donmedi.");
  }

  return mergeSupabaseBusiness(updatedRow);
}

export async function updateBusinessSubscriptionInSupabase(
  business: Business,
  payload: SubscriptionUpdatePayload,
) {
  const response = await requestAdminApi("/api/admin/update-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessId: business.id,
      slug: business.slug,
      ...payload,
    }),
  });

  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    throw new Error("Abonelik işlemi tamamlanamadı. Lütfen tekrar deneyin.");
  }

  const selectedRow = body?.business as SupabaseBusinessRow | undefined;

  if (!selectedRow?.slug) {
    throw new Error("Abonelik işlemi tamamlanamadı. Lütfen tekrar deneyin.");
  }

  verifySubscriptionUpdate(selectedRow, payload);

  return mergeSupabaseBusiness(selectedRow, business);
}
