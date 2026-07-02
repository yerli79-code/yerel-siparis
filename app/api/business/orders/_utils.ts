import { NextResponse } from "next/server";

export type OrderStatus =
  | "new"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled";

export type OrderType = "delivery" | "pickup";

export type SupabaseUser = {
  id: string;
  email?: string;
};

export type BusinessAccessRow = {
  id: string;
  owner_id: string | null;
  is_active: boolean | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
};

export type OrderRow = {
  id: string;
  order_number: number | string;
  business_id: string;
  status: OrderStatus;
  order_type: OrderType;
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_note: string | null;
  total_amount: number | string;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number | string;
  quantity: number;
  line_total: number | string;
  created_at: string;
};

export type AtomicOrderResult = {
  order_number: number | string;
  total_amount: number | string;
  order_type: OrderType;
};

export class OrderRpcError extends Error {
  reason:
    | "idempotency_conflict"
    | "business_not_found"
    | "products_not_available"
    | "business_not_available"
    | "validation"
    | "failed";

  constructor(reason: OrderRpcError["reason"]) {
    super("Siparis kaydi olusturulamadi.");
    this.name = "OrderRpcError";
    this.reason = reason;
  }
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const orderStatuses: OrderStatus[] = [
  "new",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
];

export const orderTypes: OrderType[] = ["delivery", "pickup"];

const orderSelect =
  "id,order_number,business_id,status,order_type,customer_name,customer_phone,customer_address,customer_note,total_amount,currency,created_at,updated_at";
const orderItemSelect =
  "id,order_id,product_id,product_name,unit_price,quantity,line_total,created_at";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getSupabaseServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase public ortam degiskenleri eksik.");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY eksik.");
  }

  return { url, anonKey, serviceRoleKey };
}

export async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const [type, token] = header.split(" ");

  if (type.toLowerCase() !== "bearer" || !token?.trim()) return "";
  return token.trim();
}

function serviceHeaders(serviceRoleKey: string, contentType = false) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...(contentType ? { "Content-Type": "application/json" } : {}),
  };
}

export async function getUserFromToken(
  url: string,
  anonKey: string,
  accessToken: string,
) {
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await readJson(response);

  if (!response.ok || !body?.id) {
    return null;
  }

  return body as SupabaseUser;
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && orderStatuses.includes(value as OrderStatus);
}

export function isOrderType(value: unknown): value is OrderType {
  return typeof value === "string" && orderTypes.includes(value as OrderType);
}

export function toNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function isBusinessOperational(business: BusinessAccessRow) {
  if (!business.is_active) return false;
  if (business.subscription_status !== "active") return false;
  if (!business.subscription_expires_at) return false;

  const expiresAt = new Date(business.subscription_expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function mapOrder(row: OrderRow, items: OrderItemRow[] = []) {
  return {
    id: row.id,
    orderNumber: Number(row.order_number),
    status: row.status,
    orderType: row.order_type,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerAddress: row.customer_address,
    customerNote: row.customer_note,
    totalAmount: toNumber(row.total_amount),
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      productName: item.product_name,
      unitPrice: toNumber(item.unit_price),
      quantity: item.quantity,
      lineTotal: toNumber(item.line_total),
    })),
  };
}

export async function fetchBusinessesForUser(
  url: string,
  serviceRoleKey: string,
  userId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?owner_id=eq.${encodeURIComponent(
      userId,
    )}&select=id,owner_id,is_active,subscription_status,subscription_expires_at&limit=2`,
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  if (!response.ok) {
    const error = new Error("Isletme bilgisi alinamadi.");

    if (response.status === 401 || response.status === 403) {
      error.name = "BusinessLookupAuthError";
    } else if (response.status === 404) {
      error.name = "BusinessLookupNotFoundError";
    } else if (response.status >= 500 && response.status <= 599) {
      error.name = "BusinessLookupServerError";
    } else {
      error.name = "BusinessLookupHttpError";
    }

    throw error;
  }

  const body = await readJson(response);
  return Array.isArray(body) ? (body as BusinessAccessRow[]) : [];
}

export function getSingleUserBusiness(businesses: BusinessAccessRow[]) {
  if (businesses.length === 0) {
    throw new Error("Giris yapan kullaniciya ait isletme bulunamadi.");
  }
  if (businesses.length > 1) {
    throw new Error("Bu kullaniciya ait birden fazla isletme var.");
  }

  return businesses[0];
}

export async function createOrderWithItemsRpc(
  url: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(
    `${url}/rest/v1/rpc/create_order_with_items`,
    {
    method: "POST",
    headers: serviceHeaders(serviceRoleKey, true),
    body: JSON.stringify(payload),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    const errorMessage =
      isPlainObject(body) && typeof body.message === "string"
        ? body.message
        : "";
    if (
      errorMessage.includes("idempotency_key_reused_with_different_payload")
    ) {
      throw new OrderRpcError("idempotency_conflict");
    }
    if (errorMessage.includes("business_not_found")) {
      throw new OrderRpcError("business_not_found");
    }
    if (errorMessage.includes("products_not_available")) {
      throw new OrderRpcError("products_not_available");
    }
    if (errorMessage.includes("business_not_available")) {
      throw new OrderRpcError("business_not_available");
    }
    if (
      errorMessage.includes("minimum_order_not_met") ||
      errorMessage.includes("invalid_")
    ) {
      throw new OrderRpcError("validation");
    }
    throw new OrderRpcError("failed");
  }

  const order = Array.isArray(body) ? body[0] : body;
  if (
    !isPlainObject(order) ||
    !Number.isFinite(Number(order.order_number)) ||
    !Number.isFinite(Number(order.total_amount)) ||
    !isOrderType(order.order_type)
  ) {
    throw new OrderRpcError("failed");
  }

  return order as AtomicOrderResult;
}

export async function fetchOrdersForBusiness(
  url: string,
  serviceRoleKey: string,
  businessId: string,
  options: { status?: OrderStatus; limit: number },
) {
  const statusFilter = options.status ? `&status=eq.${options.status}` : "";
  const response = await fetch(
    `${url}/rest/v1/orders?business_id=eq.${encodeURIComponent(
      businessId,
    )}${statusFilter}&select=${orderSelect}&order=created_at.desc&limit=${options.limit}`,
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error("Siparisler alinamadi.");
  }

  return Array.isArray(body) ? (body as OrderRow[]) : [];
}

export async function fetchOrderItemsForOrders(
  url: string,
  serviceRoleKey: string,
  orderIds: string[],
) {
  if (orderIds.length === 0) return [];
  const response = await fetch(
    `${url}/rest/v1/order_items?order_id=in.(${orderIds.join(
      ",",
    )})&select=${orderItemSelect}&order=created_at.asc`,
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error("Siparis urunleri alinamadi.");
  }

  return Array.isArray(body) ? (body as OrderItemRow[]) : [];
}

export async function fetchOrderById(
  url: string,
  serviceRoleKey: string,
  orderId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/orders?id=eq.${encodeURIComponent(
      orderId,
    )}&select=${orderSelect}&limit=1`,
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error("Siparis bilgisi alinamadi.");
  }

  return Array.isArray(body) ? (body[0] as OrderRow | undefined) : null;
}

export async function updateOrderStatusById(
  url: string,
  serviceRoleKey: string,
  orderId: string,
  businessId: string,
  status: OrderStatus,
) {
  const response = await fetch(
    `${url}/rest/v1/orders?id=eq.${encodeURIComponent(
      orderId,
    )}&business_id=eq.${encodeURIComponent(businessId)}&select=${orderSelect}`,
    {
      method: "PATCH",
      headers: {
        ...serviceHeaders(serviceRoleKey, true),
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status }),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error("Siparis durumu guncellenemedi.");
  }

  const order = Array.isArray(body) ? body[0] : body;
  if (!order?.id) {
    throw new Error("Siparis durumu guncellendi ancak bilgi donmedi.");
  }

  return order as OrderRow;
}
