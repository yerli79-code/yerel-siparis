import "server-only";

import { adminServiceFetch, readJsonBody } from "./dal";
import { AdminError } from "./errors";
import {
  ADMIN_BUSINESS_DETAIL_SELECT,
  ADMIN_ORDER_SUMMARY_SELECT,
  ADMIN_RECENT_ORDER_LIMIT,
  buildAdminBusinessSafePatchParams,
  type AdminBusinessDetail,
  type AdminBusinessSafePatch,
  type AdminBusinessSafePatchResult,
  type AdminOrderSummary,
} from "./business-detail-contract";

type BusinessRow = {
  id?: unknown;
  owner_id?: unknown;
  name?: unknown;
  slug?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  description?: unknown;
  category?: unknown;
  city?: unknown;
  district?: unknown;
  neighborhood?: unknown;
  address?: unknown;
  whatsapp_order_number?: unknown;
  delivery_status?: unknown;
  is_active?: unknown;
  is_open?: unknown;
  payment_method_mode?: unknown;
  minimum_order_amount?: unknown;
  preparation_time_minutes?: unknown;
  order_note?: unknown;
  logo_url?: unknown;
  cover_image_url?: unknown;
  subscription_status?: unknown;
  subscription_started_at?: unknown;
  subscription_expires_at?: unknown;
};

type OrderRow = {
  id?: unknown;
  business_order_number?: unknown;
  status?: unknown;
  order_type?: unknown;
  total_amount?: unknown;
  currency?: unknown;
  created_at?: unknown;
};

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapOrder(row: OrderRow): AdminOrderSummary | null {
  if (typeof row.id !== "string" || typeof row.created_at !== "string") return null;
  const totalAmount = Number(row.total_amount);
  return {
    id: row.id,
    businessOrderNumber:
      typeof row.business_order_number === "number" ||
      typeof row.business_order_number === "string"
        ? row.business_order_number
        : "-",
    status: stringValue(row.status),
    orderType: stringValue(row.order_type),
    totalAmount: Number.isFinite(totalAmount) ? totalAmount : 0,
    currency: stringValue(row.currency) || "TRY",
    createdAt: row.created_at,
  };
}

function parseExactCount(response: Response) {
  const header = response.headers.get("content-range");
  const match = header?.match(/\/(\d+)$/);
  if (!response.ok || !match) {
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme sayımları alınamadı.", 503);
  }
  return Number(match[1]);
}

async function countRows(table: "products" | "orders", businessId: string) {
  const params = new URLSearchParams({
    business_id: `eq.${businessId}`,
    select: "id",
  });
  const response = await adminServiceFetch(`/rest/v1/${table}?${params}`, {
    method: "HEAD",
    headers: { Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" },
  });
  return parseExactCount(response);
}

async function fetchOrders(businessId: string, limit: number) {
  const params = new URLSearchParams({
    business_id: `eq.${businessId}`,
    select: ADMIN_ORDER_SUMMARY_SELECT,
    order: "created_at.desc,id.desc",
    limit: String(limit),
  });
  const response = await adminServiceFetch(`/rest/v1/orders?${params}`);
  const body = await readJsonBody(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError("ADMIN_UNAVAILABLE", "Sipariş özeti alınamadı.", 503);
  }
  return (body as OrderRow[])
    .map(mapOrder)
    .filter((order): order is AdminOrderSummary => order !== null);
}

async function fetchOwnerEmail(ownerId: string | null) {
  if (!ownerId) return "";
  const params = new URLSearchParams({ id: `eq.${ownerId}`, select: "email", limit: "1" });
  const response = await adminServiceFetch(`/rest/v1/profiles?${params}`);
  const body = await readJsonBody(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme sahibi bilgisi alınamadı.", 503);
  }
  return typeof body[0]?.email === "string" ? body[0].email : "";
}

async function fetchBusinessRow(businessId: string) {
  const params = new URLSearchParams({
    id: `eq.${businessId}`,
    select: ADMIN_BUSINESS_DETAIL_SELECT,
    limit: "1",
  });
  const response = await adminServiceFetch(`/rest/v1/businesses?${params}`);
  const body = await readJsonBody(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme bilgileri alınamadı.", 503);
  }
  return (body[0] as BusinessRow | undefined) ?? null;
}

export async function fetchAdminBusinessDetail(
  businessId: string,
): Promise<AdminBusinessDetail | null> {
  const row = await fetchBusinessRow(businessId);
  if (!row) return null;
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme bilgileri geçersiz.", 503);
  }

  const ownerId = typeof row.owner_id === "string" ? row.owner_id : null;
  const [ownerEmail, products, orders, lastOrders, recentOrders] = await Promise.all([
    fetchOwnerEmail(ownerId),
    countRows("products", businessId),
    countRows("orders", businessId),
    fetchOrders(businessId, 1),
    fetchOrders(businessId, ADMIN_RECENT_ORDER_LIMIT),
  ]);

  const subscriptionStatus =
    row.subscription_status === "active" ||
    row.subscription_status === "blocked" ||
    row.subscription_status === "expired"
      ? row.subscription_status
      : "expired";

  return {
    business: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      description: stringValue(row.description),
      category: stringValue(row.category),
      city: stringValue(row.city),
      district: stringValue(row.district),
      neighborhood: stringValue(row.neighborhood),
      address: stringValue(row.address),
      whatsappOrderNumber: stringValue(row.whatsapp_order_number),
      deliveryStatus: stringValue(row.delivery_status),
      isActive: row.is_active === true,
      isOpen: row.is_open !== false,
      paymentMethodMode: stringValue(row.payment_method_mode) || "cash",
      minimumOrderAmount: nullableNumber(row.minimum_order_amount),
      preparationTimeMinutes: nullableNumber(row.preparation_time_minutes),
      orderNote: nullableString(row.order_note),
      logoUrl: nullableString(row.logo_url),
      coverImageUrl: nullableString(row.cover_image_url),
      subscriptionStatus,
      subscriptionStartedAt: nullableString(row.subscription_started_at),
      subscriptionExpiresAt: nullableString(row.subscription_expires_at),
    },
    owner: { email: ownerEmail },
    counts: { products, orders },
    lastOrder: lastOrders[0] ?? null,
    recentOrders,
  };
}

async function businessExists(businessId: string) {
  const params = new URLSearchParams({ id: `eq.${businessId}`, select: "id", limit: "1" });
  const response = await adminServiceFetch(`/rest/v1/businesses?${params}`);
  const body = await readJsonBody(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme kaydı doğrulanamadı.", 503);
  }
  return body.length === 1;
}

export async function updateAdminBusinessSafely(
  businessId: string,
  patch: AdminBusinessSafePatch,
): Promise<AdminBusinessSafePatchResult> {
  const params = buildAdminBusinessSafePatchParams(businessId, patch.expectedUpdatedAt);
  const response = await adminServiceFetch(`/rest/v1/businesses?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ name: patch.name, slug: patch.slug }),
  });
  const body = await readJsonBody(response);

  if (!response.ok) {
    const databaseCode =
      body && typeof body === "object" && "code" in body ? (body as { code?: unknown }).code : null;
    if (databaseCode === "23505") {
      throw new AdminError(
        "DUPLICATE_SLUG",
        "Bu slug başka bir işletme tarafından kullanılıyor.",
        409,
      );
    }
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme kaydı güncellenemedi.", 503);
  }

  const row = Array.isArray(body) ? body[0] : null;
  if (!row) {
    if (!(await businessExists(businessId))) {
      throw new AdminError("NOT_FOUND", "İşletme bulunamadı.", 404);
    }
    throw new AdminError(
      "CONFLICT",
      "Bu işletme başka bir işlemde güncellendi. En son bilgileri yükleyip değişikliklerinizi yeniden kontrol edin.",
      409,
    );
  }

  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    throw new AdminError("ADMIN_UNAVAILABLE", "Güncel işletme bilgisi alınamadı.", 503);
  }

  return { id: row.id, name: row.name, slug: row.slug, updatedAt: row.updated_at };
}
