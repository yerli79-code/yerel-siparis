import { NextResponse } from "next/server";
import { normalizeProductCategory } from "../../../../lib/product-categories";

export type SupabaseUser = { id: string; email?: string };

export type BusinessAccessRow = {
  id: string;
  owner_id: string | null;
  is_active: boolean | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
};

export type SupabaseProductRow = {
  id: string;
  business_id: string;
  client_product_id: string | null;
  name: string;
  price: number | string;
  description: string | null;
  category: string | null;
  image_label: string | null;
  image_url: string | null;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
};

export type ProductUpdatePayload = Partial<
  Record<
    | "name"
    | "price"
    | "description"
    | "category"
    | "image_label"
    | "image_url"
    | "is_active"
    | "sort_order",
    string | number | boolean | null
  >
>;

export type ProductInsertPayload = ProductUpdatePayload & {
  business_id: string;
  client_product_id: string;
  image_label: string;
};

export type ProductMutationErrorCode =
  | "PRODUCT_CONFLICT"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_FORBIDDEN"
  | "PRODUCT_UNAUTHORIZED"
  | "PRODUCT_UNAVAILABLE"
  | "INVALID_PRODUCT_MUTATION";

export class ProductRequestError extends Error {
  readonly code: ProductMutationErrorCode;
  readonly status: number;

  constructor(
    code: ProductMutationErrorCode,
    status: number,
    message = code,
  ) {
    super(message);
    this.name = "ProductRequestError";
    this.code = code;
    this.status = status;
  }
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PRODUCT_REORDER_MAX_ITEMS = 500;

export const productSelect =
  "id,business_id,client_product_id,name,price,description,category,image_label,image_url,is_active,sort_order,created_at,updated_at";

const productPrivateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Authorization",
};

const forbiddenFields = new Set([
  "id",
  "business_id",
  "businessId",
  "owner_id",
  "ownerId",
  "user_id",
  "userId",
  "client_product_id",
  "clientProductId",
  "subscription_status",
  "subscriptionStatus",
  "subscription_started_at",
  "subscriptionStartedAt",
  "subscription_expires_at",
  "subscriptionExpiresAt",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
]);

const allowedProductFields = new Set([
  "name",
  "price",
  "description",
  "category",
  "imageLabel",
  "imageUrl",
  "isActive",
  "sortOrder",
]);

export function productJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: productPrivateHeaders,
  });
}

export function productError(code: ProductMutationErrorCode, status: number) {
  return productJson({ code }, status);
}

export function resolveProductRouteError(error: unknown) {
  if (error instanceof ProductRequestError) {
    return { code: error.code, status: error.status };
  }
  return { code: "PRODUCT_UNAVAILABLE" as const, status: 503 };
}

export function getSupabaseServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Product server configuration is unavailable.");
  }
  return { url, anonKey, serviceRoleKey };
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

function serviceHeaders(serviceRoleKey: string, contentType = false) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...(contentType ? { "Content-Type": "application/json" } : {}),
  };
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const [type, token] = header.split(" ");
  if (type.toLowerCase() !== "bearer" || !token?.trim()) return "";
  return token.trim();
}

export async function getUserFromToken(
  url: string,
  anonKey: string,
  accessToken: string,
) {
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  let body: unknown;
  try {
    body = await readJson(response);
  } catch {
    return null;
  }
  if (
    !response.ok ||
    !isPlainObject(body) ||
    typeof body.id !== "string" ||
    !UUID_PATTERN.test(body.id)
  ) {
    return null;
  }
  return body as SupabaseUser;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowedFields: Set<string>,
) {
  if (Object.keys(record).some((key) => !allowedFields.has(key))) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
}

function getStrictProductInput(body: Record<string, unknown>) {
  if (!isPlainObject(body.input)) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
  if (Object.keys(body.input).some((key) => forbiddenFields.has(key))) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
  assertOnlyAllowedKeys(body.input, allowedProductFields);
  return body.input;
}

export function getCreateProductInput(body: Record<string, unknown>) {
  assertOnlyAllowedKeys(body, new Set(["input"]));
  if (!Object.prototype.hasOwnProperty.call(body, "input")) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
  return getStrictProductInput(body);
}

export function getProductMutationRequest(body: Record<string, unknown>) {
  assertOnlyAllowedKeys(body, new Set(["input", "expectedUpdatedAt"]));
  if (
    !Object.prototype.hasOwnProperty.call(body, "input") ||
    !Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt") ||
    !isValidProductMutationTimestamp(body.expectedUpdatedAt)
  ) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
  return {
    input: getStrictProductInput(body),
    expectedUpdatedAt: body.expectedUpdatedAt,
  };
}

export function getProductDeleteRequest(body: Record<string, unknown>) {
  assertOnlyAllowedKeys(body, new Set(["expectedUpdatedAt"]));
  if (
    !Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt") ||
    !isValidProductMutationTimestamp(body.expectedUpdatedAt)
  ) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
  return { expectedUpdatedAt: body.expectedUpdatedAt };
}

export function isValidProductMutationTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value !== value.trim()) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day &&
    Number(hourText) <= 23 &&
    Number(minuteText) <= 59 &&
    Number(secondText) <= 59 &&
    Number.isFinite(new Date(value).getTime())
  );
}

function addNullableStringField(
  payload: ProductUpdatePayload,
  input: Record<string, unknown>,
  inputKey: string,
  payloadKey: "description" | "category" | "image_label" | "image_url",
  fallback?: string,
) {
  if (!(inputKey in input)) return;
  const value = input[inputKey];
  if (value === null) {
    payload[payloadKey] = fallback ?? null;
    return;
  }
  if (typeof value !== "string") {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
  const trimmed = value.trim();
  payload[payloadKey] = trimmed || fallback || null;
}

export function buildProductPayload(
  input: Record<string, unknown>,
  options: {
    requireName?: boolean;
    requirePrice?: boolean;
    requireCategory?: boolean;
  } = {},
) {
  const payload: ProductUpdatePayload = {};
  if ("name" in input) {
    if (typeof input.name !== "string" || !input.name.trim()) {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }
    payload.name = input.name.trim();
  } else if (options.requireName) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }

  if ("price" in input) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }
    payload.price = price;
  } else if (options.requirePrice) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }

  addNullableStringField(payload, input, "description", "description", "");
  if ("category" in input) {
    const category = normalizeProductCategory(input.category);
    if (!category) {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }
    payload.category = category;
  } else if (options.requireCategory) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }

  if ("imageLabel" in input) {
    const value = input.imageLabel;
    if (value !== null && value !== undefined && typeof value !== "string") {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }
    payload.image_label = typeof value === "string" ? value.trim() : "";
  }
  addNullableStringField(payload, input, "imageUrl", "image_url");

  if ("isActive" in input) {
    if (typeof input.isActive !== "boolean") {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }
    payload.is_active = input.isActive;
  }
  if ("sortOrder" in input) {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }
    payload.sort_order = sortOrder;
  }
  if (Object.keys(payload).length === 0) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }
  return payload;
}

export function isProductPayloadNoop(
  product: SupabaseProductRow,
  payload: ProductUpdatePayload,
) {
  const currentValues: Record<string, unknown> = {
    name: product.name,
    price: Number(product.price),
    description: product.description ?? "",
    category: product.category,
    image_label: product.image_label ?? "",
    image_url: product.image_url,
    is_active: product.is_active ?? true,
    sort_order: product.sort_order ?? 0,
  };
  return Object.entries(payload).every(
    ([key, value]) => currentValues[key] === value,
  );
}

export function isSupabaseProductRow(value: unknown): value is SupabaseProductRow {
  if (!isPlainObject(value)) return false;
  const price = Number(value.price);
  return (
    typeof value.id === "string" &&
    UUID_PATTERN.test(value.id) &&
    typeof value.business_id === "string" &&
    UUID_PATTERN.test(value.business_id) &&
    (value.client_product_id === null || typeof value.client_product_id === "string") &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    Number.isFinite(price) &&
    price >= 0 &&
    (value.description === null || typeof value.description === "string") &&
    (value.category === null || typeof value.category === "string") &&
    (value.image_label === null || typeof value.image_label === "string") &&
    (value.image_url === null || typeof value.image_url === "string") &&
    (value.is_active === null || typeof value.is_active === "boolean") &&
    (value.sort_order === null ||
      (Number.isInteger(value.sort_order) && Number(value.sort_order) >= 0)) &&
    typeof value.created_at === "string" &&
    isValidProductMutationTimestamp(value.updated_at)
  );
}

function requireProductRow(value: unknown) {
  if (!isSupabaseProductRow(value)) {
    throw new Error("Invalid authoritative product row.");
  }
  return value;
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
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body)) throw new Error("Business lookup failed.");
  return body as BusinessAccessRow[];
}

export function getSingleUserBusiness(businesses: BusinessAccessRow[]) {
  if (businesses.length !== 1) {
    throw new ProductRequestError("PRODUCT_FORBIDDEN", 403);
  }
  return businesses[0];
}

export function ensureProductWriteAllowed(business: BusinessAccessRow) {
  if (
    !business.is_active ||
    business.subscription_status !== "active" ||
    !business.subscription_expires_at
  ) {
    throw new ProductRequestError("PRODUCT_FORBIDDEN", 403);
  }
  const expiresAt = new Date(business.subscription_expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ProductRequestError("PRODUCT_FORBIDDEN", 403);
  }
}

export async function fetchProductsForBusiness(
  url: string,
  serviceRoleKey: string,
  businessId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/products?business_id=eq.${encodeURIComponent(
      businessId,
    )}&select=${productSelect}&order=sort_order.asc,created_at.asc`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body) || !body.every(isSupabaseProductRow)) {
    throw new Error("Product list lookup failed.");
  }
  return body;
}

export async function fetchProductById(
  url: string,
  serviceRoleKey: string,
  productId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/products?id=eq.${encodeURIComponent(
      productId,
    )}&select=${productSelect}&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body) || body.length > 1) {
    throw new Error("Product lookup failed.");
  }
  return body.length === 0 ? null : requireProductRow(body[0]);
}

export async function fetchBusinessById(
  url: string,
  serviceRoleKey: string,
  businessId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(
      businessId,
    )}&select=id,owner_id,is_active,subscription_status,subscription_expires_at&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body) || body.length > 1) {
    throw new Error("Business lookup failed.");
  }
  return body[0] as BusinessAccessRow | undefined;
}

export async function insertProduct(
  url: string,
  serviceRoleKey: string,
  payload: ProductInsertPayload,
) {
  const response = await fetch(`${url}/rest/v1/products?select=${productSelect}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body) || body.length !== 1) {
    throw new Error("Product insert failed.");
  }
  return requireProductRow(body[0]);
}

export async function updateProductConditionally(
  url: string,
  serviceRoleKey: string,
  productId: string,
  businessId: string,
  expectedUpdatedAt: string,
  payload: ProductUpdatePayload,
) {
  const params = new URLSearchParams({
    id: `eq.${productId}`,
    business_id: `eq.${businessId}`,
    updated_at: `eq.${expectedUpdatedAt}`,
    select: productSelect,
  });
  const response = await fetch(`${url}/rest/v1/products?${params.toString()}`, {
    method: "PATCH",
    headers: {
      ...serviceHeaders(serviceRoleKey, true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body) || body.length > 1) {
    throw new Error("Product update failed.");
  }
  return body.length === 0 ? null : requireProductRow(body[0]);
}

export async function deleteProductConditionally(
  url: string,
  serviceRoleKey: string,
  productId: string,
  businessId: string,
  expectedUpdatedAt: string,
) {
  const params = new URLSearchParams({
    id: `eq.${productId}`,
    business_id: `eq.${businessId}`,
    updated_at: `eq.${expectedUpdatedAt}`,
    select: productSelect,
  });
  const response = await fetch(`${url}/rest/v1/products?${params.toString()}`, {
    method: "DELETE",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      Prefer: "return=representation",
    },
  });
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body) || body.length > 1) {
    throw new Error("Product delete failed.");
  }
  return body.length === 0 ? null : requireProductRow(body[0]);
}

export async function reorderProductsAtomically(
  url: string,
  serviceRoleKey: string,
  businessId: string,
  items: Array<{
    productId: string;
    sortOrder: number;
    expectedUpdatedAt: string;
  }>,
) {
  const response = await fetch(
    `${url}/rest/v1/rpc/reorder_business_products_atomic`,
    {
      method: "POST",
      headers: serviceHeaders(serviceRoleKey, true),
      body: JSON.stringify({
        p_business_id: businessId,
        p_items: items.map((item) => ({
          productId: item.productId,
          sortOrder: item.sortOrder,
          expectedUpdatedAt: item.expectedUpdatedAt,
        })),
      }),
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    if (
      isPlainObject(body) &&
      body.message === "PRODUCT_CONFLICT"
    ) {
      throw new ProductRequestError("PRODUCT_CONFLICT", 409);
    }
    if (isPlainObject(body) && body.message === "PRODUCT_NOT_FOUND") {
      throw new ProductRequestError("PRODUCT_NOT_FOUND", 404);
    }
    throw new Error("Product reorder failed.");
  }
  if (
    !Array.isArray(body) ||
    body.length !== items.length ||
    !body.every(isSupabaseProductRow)
  ) {
    throw new Error("Invalid product reorder result.");
  }
  const returnedIds = new Set(body.map((product) => product.id));
  if (items.some((item) => !returnedIds.has(item.productId))) {
    throw new Error("Incomplete product reorder result.");
  }
  return body;
}

export async function getNextSortOrder(
  url: string,
  serviceRoleKey: string,
  businessId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/products?business_id=eq.${encodeURIComponent(
      businessId,
    )}&select=sort_order&order=sort_order.desc.nullslast&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) },
  );
  const body = await readJson(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new Error("Product sort lookup failed.");
  }
  const currentMax = Number(body[0]?.sort_order ?? 0);
  return Number.isInteger(currentMax) && currentMax >= 0 ? currentMax + 1 : 1;
}

export function createClientProductId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  throw new Error("Secure UUID generation is unavailable.");
}
