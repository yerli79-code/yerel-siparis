import { NextResponse } from "next/server";
import { normalizeProductCategory } from "../../../../lib/product-categories";

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

export class ProductRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProductRequestError";
    this.status = status;
  }
}

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const productSelect =
  "id,business_id,client_product_id,name,price,description,category,image_label,image_url,is_active,sort_order,created_at,updated_at";

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
  "is_active",
  "isActive",
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

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function resolveProductRouteError(
  error: unknown,
  fallbackMessage: string,
) {
  if (error instanceof ProductRequestError) {
    return { message: error.message, status: error.status };
  }

  return { message: fallbackMessage, status: 500 };
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

export function safeSupabaseError(prefix: string, _body: unknown) {
  return prefix;
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertNoForbiddenFields(record: Record<string, unknown>) {
  const found = Object.keys(record).filter((key) => forbiddenFields.has(key));
  if (found.length > 0) {
    throw new ProductRequestError(
      `Bu alanlar urun isleminde kullanilamaz: ${found.join(", ")}`,
    );
  }
}

function assertOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowedFields: Set<string>,
) {
  const unknownFields = Object.keys(record).filter(
    (key) => !allowedFields.has(key),
  );
  if (unknownFields.length > 0) {
    throw new ProductRequestError(
      `Bu alanlar urun isleminde kullanilamaz: ${unknownFields.join(", ")}`,
    );
  }
}

export function getProductInput(body: Record<string, unknown>) {
  assertOnlyAllowedKeys(body, new Set(["input"]));
  if (!isPlainObject(body.input)) {
    throw new ProductRequestError("Urun bilgileri eksik veya gecersiz.");
  }

  const inputForbiddenFields = new Set(
    [...forbiddenFields].filter((field) => field !== "isActive"),
  );
  const found = Object.keys(body.input).filter((key) =>
    inputForbiddenFields.has(key),
  );
  if (found.length > 0) {
    throw new ProductRequestError(
      `Bu alanlar urun isleminde kullanilamaz: ${found.join(", ")}`,
    );
  }
  assertOnlyAllowedKeys(body.input, allowedProductFields);

  return body.input;
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
    throw new ProductRequestError(`${inputKey} alani metin olmalidir.`);
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
    const value = input.name;
    if (typeof value !== "string" || !value.trim()) {
      throw new ProductRequestError("Urun adi bos olamaz.");
    }
    payload.name = value.trim();
  } else if (options.requireName) {
    throw new ProductRequestError("Urun adi bos olamaz.");
  }

  if ("price" in input) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new ProductRequestError("Fiyat gecerli bir sayi olmalidir.");
    }
    payload.price = price;
  } else if (options.requirePrice) {
    throw new ProductRequestError("Fiyat gecerli bir sayi olmalidir.");
  }

  addNullableStringField(payload, input, "description", "description", "");
  if ("category" in input) {
    const category = normalizeProductCategory(input.category);
    if (!category) {
      throw new ProductRequestError("Lütfen geçerli bir kategori seçin.");
    }
    payload.category = category;
  } else if (options.requireCategory) {
    throw new ProductRequestError("Lütfen geçerli bir kategori seçin.");
  }
  if ("imageLabel" in input) {
    const value = input.imageLabel;
    if (value !== null && value !== undefined) {
      if (typeof value !== "string") {
        throw new ProductRequestError("imageLabel alani metin olmalidir.");
      }
      payload.image_label = value.trim();
    }
  }
  addNullableStringField(payload, input, "imageUrl", "image_url");

  if ("isActive" in input) {
    if (typeof input.isActive !== "boolean") {
      throw new ProductRequestError("isActive alani boolean olmalidir.");
    }
    payload.is_active = input.isActive;
  }

  if ("sortOrder" in input) {
    const sortOrder = Number(input.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      throw new ProductRequestError("sortOrder gecerli bir sayi olmalidir.");
    }
    payload.sort_order = sortOrder;
  }

  if (Object.keys(payload).length === 0) {
    throw new ProductRequestError("Guncellenecek urun alani bulunamadi.");
  }

  return payload;
}

function serviceHeaders(serviceRoleKey: string, contentType = false) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    ...(contentType ? { "Content-Type": "application/json" } : {}),
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
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Isletme bilgisi alinamadi", body));
  }

  return Array.isArray(body) ? (body as BusinessAccessRow[]) : [];
}

export function getSingleUserBusiness(businesses: BusinessAccessRow[]) {
  if (businesses.length === 0) {
    throw new ProductRequestError(
      "Giris yapan kullaniciya ait isletme bulunamadi.",
    );
  }
  if (businesses.length > 1) {
    throw new ProductRequestError(
      "Bu kullaniciya ait birden fazla isletme var. Islem guvenli sekilde tamamlanamadi.",
    );
  }

  return businesses[0];
}

export function ensureProductWriteAllowed(business: BusinessAccessRow) {
  if (!business.is_active) {
    throw new ProductRequestError(
      "Isletme aktif olmadigi icin urun islemi yapilamaz.",
    );
  }
  if (business.subscription_status !== "active") {
    throw new ProductRequestError(
      "Abonelik aktif olmadigi icin urun islemi yapilamaz.",
    );
  }
  if (!business.subscription_expires_at) {
    throw new ProductRequestError(
      "Abonelik bitis tarihi bulunmadigi icin urun islemi yapilamaz.",
    );
  }

  const expiresAt = new Date(business.subscription_expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ProductRequestError(
      "Abonelik suresi doldugu icin urun islemi yapilamaz.",
    );
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
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Urunler alinamadi", body));
  }

  return Array.isArray(body) ? (body as SupabaseProductRow[]) : [];
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
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Urun bilgisi alinamadi", body));
  }

  return Array.isArray(body) ? (body[0] as SupabaseProductRow | undefined) : null;
}

export async function fetchProductsByIds(
  url: string,
  serviceRoleKey: string,
  productIds: string[],
) {
  const response = await fetch(
    `${url}/rest/v1/products?id=in.(${productIds.join(
      ",",
    )})&select=${productSelect}`,
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Urun bilgileri alinamadi", body));
  }

  return Array.isArray(body) ? (body as SupabaseProductRow[]) : [];
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
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Isletme bilgisi alinamadi", body));
  }

  return Array.isArray(body) ? (body[0] as BusinessAccessRow | undefined) : null;
}

export function ensureBusinessOwner(
  business: BusinessAccessRow | null | undefined,
  userId: string,
) {
  if (!business) {
    throw new ProductRequestError("Urun bulunamadi.", 404);
  }
  if (business.owner_id !== userId) {
    throw new ProductRequestError("Bu urun icin yetkiniz yok.", 403);
  }
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

  if (!response.ok) {
    throw new Error("Urun olusturulamadi. Lutfen bilgileri kontrol edip tekrar deneyin.");
  }

  const product = Array.isArray(body) ? body[0] : body;
  if (!product?.id) {
    throw new Error("Urun olusturuldu ancak kayit bilgisi donmedi.");
  }

  return product as SupabaseProductRow;
}

export async function updateProductById(
  url: string,
  serviceRoleKey: string,
  productId: string,
  payload: ProductUpdatePayload,
) {
  const response = await fetch(
    `${url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=${productSelect}`,
    {
      method: "PATCH",
      headers: {
        ...serviceHeaders(serviceRoleKey, true),
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error("Urun guncellenemedi. Lutfen bilgileri kontrol edip tekrar deneyin.");
  }

  const product = Array.isArray(body) ? body[0] : body;
  if (!product?.id) {
    throw new Error("Urun guncellendi ancak kayit bilgisi donmedi.");
  }

  return product as SupabaseProductRow;
}

export async function deleteProductById(
  url: string,
  serviceRoleKey: string,
  productId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
    {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Urun silinemedi", body));
  }
}

export async function bulkUpdateProductSortOrders(
  url: string,
  serviceRoleKey: string,
  items: Array<{ id: string; sort_order: number }>,
) {
  const response = await fetch(
    `${url}/rest/v1/products?on_conflict=id&select=${productSelect}`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey, true),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(items),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Urun sirasi guncellenemedi", body));
  }

  return Array.isArray(body) ? (body as SupabaseProductRow[]) : [];
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
    {
      headers: serviceHeaders(serviceRoleKey),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Urun sirasi hesaplanamadi", body));
  }

  const currentMax = Array.isArray(body) ? Number(body[0]?.sort_order ?? 0) : 0;
  return Number.isFinite(currentMax) ? currentMax + 1 : 1;
}

export function createClientProductId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}
