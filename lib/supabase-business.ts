import type { Business } from "./businesses";
import {
  getPaymentMethodModeOrDefault,
  type PaymentMethodMode,
} from "./payment-methods";

export type BusinessProduct = {
  id: string;
  businessId: string;
  clientProductId: string | null;
  name: string;
  price: number;
  description: string | null;
  category: string | null;
  imageLabel: string | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type BusinessPanelBusiness = Business & {
  id: string;
  ownerId: string | null;
  city: string | null;
  paymentMethodMode: PaymentMethodMode;
  latitude: number | null;
  longitude: number | null;
  serviceRadiusKm: number | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
};

export type ProductInput = {
  clientProductId?: string | null;
  name: string;
  price: number;
  description?: string | null;
  category?: string | null;
  imageLabel?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number;
};

export type BusinessProfileInput = {
  name: string;
  description?: string | null;
  whatsappOrderNumber?: string | null;
  city?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  deliveryStatus?: string | null;
  paymentMethodMode: PaymentMethodMode;
  minimumOrderAmount?: number | null;
  preparationTimeMinutes?: number | null;
  isOpen?: boolean;
  orderNote?: string | null;
  serviceRadiusKm?: number | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
};

type SupabaseBusinessRow = {
  id: string;
  owner_id: string | null;
  slug: string;
  name: string | null;
  description: string | null;
  whatsapp_order_number: string | null;
  email: string | null;
  created_at: string | null;
  category: string | null;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  delivery_status: string | null;
  payment_method_mode?: string | null;
  minimum_order_amount?: number | string | null;
  preparation_time_minutes?: number | null;
  is_open?: boolean | null;
  order_note?: string | null;
  logo_text: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  service_radius_km: number | null;
  subscription_status: "active" | "expired" | "blocked" | null;
  subscription_started_at: string | null;
  subscription_expires_at: string | null;
  is_active: boolean | null;
};

type SupabaseProductRow = {
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

type SupabasePublicProductRow = {
  id: string;
  name: string;
  price: number | string;
  description: string | null;
  category: string | null;
  image_url: string | null;
  is_active: boolean | null;
  sort_order: number | null;
};

type SupabaseUser = {
  id: string;
  email?: string;
};

const dayMs = 24 * 60 * 60 * 1000;
const publicFetchTimeoutMs = 9000;
const maxProductImageSize = 5 * 1024 * 1024;
const supportedProductImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const publicBusinessSelect = [
  "id",
  "slug",
  "name",
  "description",
  "whatsapp_order_number",
  "city",
  "district",
  "neighborhood",
  "address",
  "delivery_status",
  "payment_method_mode",
  "minimum_order_amount",
  "preparation_time_minutes",
  "is_open",
  "order_note",
  "logo_text",
  "logo_url",
  "cover_image_url",
  "subscription_status",
  "subscription_expires_at",
  "is_active",
].join(",");
const publicProductSelect = [
  "id",
  "name",
  "price",
  "description",
  "category",
  "image_url",
  "is_active",
  "sort_order",
].join(",");

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      ".env.local icinde NEXT_PUBLIC_SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_ANON_KEY eksik.",
    );
  }

  return { url, anonKey };
}

function authHeaders(accessToken?: string) {
  const { anonKey } = getSupabaseConfig();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken || anonKey}`,
    "Content-Type": "application/json",
  };
}

function formatSupabaseError(status: number, body: unknown) {
  return JSON.stringify(
    {
      status,
      supabaseError: body,
    },
    null,
    2,
  );
}

async function parseResponse(response: Response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(formatSupabaseError(response.status, body));
  }

  return body;
}

async function parseApiResponse(response: Response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const apiError = body as { error?: string; message?: string } | null;
    throw new Error(
      apiError?.error ||
        apiError?.message ||
        formatSupabaseError(response.status, body),
    );
  }

  return body;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = publicFetchTimeoutMs,
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function mapBusiness(row: SupabaseBusinessRow): BusinessPanelBusiness {
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    name: row.name ?? row.slug,
    description: row.description ?? "",
    whatsappOrderNumber: row.whatsapp_order_number ?? "",
    email: row.email ?? "",
    createdAt: row.created_at ?? new Date().toISOString(),
    category: row.category ?? "",
    city: row.city ?? "",
    district: row.district ?? "",
    neighborhood: row.neighborhood ?? "",
    address: row.address ?? "",
    deliveryStatus: row.delivery_status ?? "",
    paymentMethodMode: getPaymentMethodModeOrDefault(row.payment_method_mode),
    minimumOrderAmount: toNullableNumber(row.minimum_order_amount),
    preparationTimeMinutes:
      typeof row.preparation_time_minutes === "number"
        ? row.preparation_time_minutes
        : null,
    isOpen: row.is_open ?? true,
    orderNote: row.order_note ?? null,
    logoText: row.logo_text ?? "",
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    latitude: row.latitude,
    longitude: row.longitude,
    serviceRadiusKm: row.service_radius_km,
    subscriptionStatus: row.subscription_status ?? "expired",
    subscriptionStartedAt: row.subscription_started_at,
    subscriptionExpiresAt: row.subscription_expires_at,
    isActive: row.is_active ?? false,
    productCategories: [],
  };
}

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapProduct(row: SupabaseProductRow): BusinessProduct {
  return {
    id: row.id,
    businessId: row.business_id,
    clientProductId: row.client_product_id,
    name: row.name,
    price: Number(row.price),
    description: row.description,
    category: row.category,
    imageLabel: row.image_label,
    imageUrl: row.image_url,
    isActive: row.is_active ?? true,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPublicProduct(row: SupabasePublicProductRow): BusinessProduct {
  return {
    id: row.id,
    businessId: "",
    clientProductId: null,
    name: row.name,
    price: Number(row.price),
    description: row.description,
    category: row.category,
    imageLabel: null,
    imageUrl: row.image_url,
    isActive: row.is_active ?? true,
    sortOrder: row.sort_order ?? 0,
    createdAt: "",
    updatedAt: "",
  };
}

function createClientProductId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function extensionFromMime(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

function safeProductImageFileName(file: File) {
  const originalName = file.name || "urun-gorseli";
  const parts = originalName.split(".");
  const rawExtension = parts.length > 1 ? parts.pop() : "";
  const rawBase = parts.join(".") || originalName;
  const safeBase =
    rawBase
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "") || "urun-gorseli";
  const safeExtension =
    rawExtension?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    extensionFromMime(file.type);

  return `${safeBase}.${safeExtension}`;
}

function productPayload(input: ProductInput, ensureClientProductId = false) {
  const clientProductId = input.clientProductId?.trim();
  const category = input.category?.trim();
  const imageLabel = input.imageLabel?.trim();

  return {
    client_product_id: ensureClientProductId
      ? clientProductId || createClientProductId()
      : clientProductId || null,
    name: input.name,
    price: Number(input.price),
    description: input.description?.trim() || "",
    category: category || "Genel",
    image_label: imageLabel || "",
    image_url: input.imageUrl ?? null,
    is_active: typeof input.isActive === "boolean" ? input.isActive : true,
    sort_order: Number(input.sortOrder ?? 0),
  };
}

export async function getCurrentSupabaseUser(accessToken: string) {
  const { url } = getSupabaseConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: authHeaders(accessToken),
  });
  return (await parseResponse(response)) as SupabaseUser;
}

export async function getBusinessByOwnerId(ownerId: string, accessToken?: string) {
  const { url } = getSupabaseConfig();
  const response = await fetch(
    `${url}/rest/v1/businesses?owner_id=eq.${encodeURIComponent(
      ownerId,
    )}&select=*&limit=1`,
    {
      headers: authHeaders(accessToken),
    },
  );
  const body = (await parseResponse(response)) as SupabaseBusinessRow[];
  return body[0] ? mapBusiness(body[0]) : null;
}

export async function fetchPublicBusinessBySlug(slug: string) {
  const { url } = getSupabaseConfig();
  const response = await fetchWithTimeout(
    `${url}/rest/v1/businesses?slug=eq.${encodeURIComponent(
      slug,
    )}&select=${publicBusinessSelect}&limit=1`,
    {
      headers: authHeaders(),
    },
  );
  const body = (await parseResponse(response)) as SupabaseBusinessRow[];
  return body[0] ? mapBusiness(body[0]) : null;
}

export async function fetchPublicActiveBusinesses() {
  const { url } = getSupabaseConfig();
  const response = await fetchWithTimeout(
    `${url}/rest/v1/businesses?is_active=eq.true&select=${publicBusinessSelect}&order=name.asc`,
    {
      headers: authHeaders(),
    },
  );
  const body = (await parseResponse(response)) as SupabaseBusinessRow[];
  const now = Date.now();

  return body
    .map(mapBusiness)
    .filter((business) => {
      if (business.subscriptionStatus !== "active") return false;
      if (!business.subscriptionExpiresAt) return false;

      const expiresAt = new Date(business.subscriptionExpiresAt).getTime();
      return Number.isFinite(expiresAt) && expiresAt > now;
    });
}

export async function getCurrentUserBusiness(accessToken: string) {
  const user = await getCurrentSupabaseUser(accessToken);
  return getBusinessByOwnerId(user.id, accessToken);
}

export async function updateBusinessProfile(
  businessId: string,
  input: BusinessProfileInput,
  accessToken: string,
) {
  const payload = {
    name: input.name.trim(),
    description: input.description?.trim() || "",
    whatsapp_order_number: input.whatsappOrderNumber?.trim() || "",
    city: input.city?.trim() || null,
    district: input.district?.trim() || "",
    neighborhood: input.neighborhood?.trim() || "",
    address: input.address?.trim() || "",
    delivery_status: input.deliveryStatus?.trim() || null,
    payment_method_mode: input.paymentMethodMode,
    minimum_order_amount:
      typeof input.minimumOrderAmount === "number" &&
      Number.isFinite(input.minimumOrderAmount)
        ? input.minimumOrderAmount
        : null,
    preparation_time_minutes:
      typeof input.preparationTimeMinutes === "number" &&
      Number.isFinite(input.preparationTimeMinutes)
        ? input.preparationTimeMinutes
        : null,
    is_open: input.isOpen ?? true,
    order_note: input.orderNote?.trim() || null,
    service_radius_km:
      typeof input.serviceRadiusKm === "number" &&
      Number.isFinite(input.serviceRadiusKm)
        ? input.serviceRadiusKm
        : null,
    logo_url: input.logoUrl?.trim() || null,
    cover_image_url: input.coverImageUrl?.trim() || null,
  };

  const response = await fetch("/api/business/update-profile", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessId,
      input: payload,
    }),
  });
  const body = (await parseResponse(response)) as {
    business?: SupabaseBusinessRow;
  };

  return body.business ? mapBusiness(body.business) : null;
}

export async function uploadProductImage(
  businessId: string,
  file: File,
  accessToken: string,
) {
  if (!businessId) {
    throw new Error("Isletme bilgisi bulunamadi.");
  }
  if (!accessToken) {
    throw new Error("Oturum bulunamadi.");
  }
  if (!supportedProductImageTypes.has(file.type)) {
    throw new Error("Sadece JPG, PNG veya WEBP gorsel yukleyebilirsiniz.");
  }
  if (file.size > maxProductImageSize) {
    throw new Error("Urun gorseli en fazla 5 MB olabilir.");
  }

  const { url, anonKey } = getSupabaseConfig();
  const fileName = `${Date.now()}-${safeProductImageFileName(file)}`;
  const objectPath = `${businessId}/${fileName}`;
  const uploadUrl = `${url}/storage/v1/object/product-images/${objectPath}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: file,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.message ? ` ${body.message}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`Urun gorseli yuklenemedi.${detail}`);
  }

  return `${url}/storage/v1/object/public/product-images/${objectPath}`;
}

export async function uploadBusinessImage(
  businessId: string,
  file: File,
  imageType: "logo" | "cover",
  accessToken: string,
) {
  if (!businessId) {
    throw new Error("Isletme bilgisi bulunamadi.");
  }
  if (!accessToken) {
    throw new Error("Oturum bulunamadi.");
  }
  if (!supportedProductImageTypes.has(file.type)) {
    throw new Error("Sadece JPG, PNG veya WEBP gorsel yukleyebilirsiniz.");
  }
  if (file.size > maxProductImageSize) {
    throw new Error("Isletme gorseli en fazla 5 MB olabilir.");
  }

  const { url, anonKey } = getSupabaseConfig();
  const fileName = `${Date.now()}-${safeProductImageFileName(file)}`;
  const objectPath = `${businessId}/${imageType}/${fileName}`;
  const uploadUrl = `${url}/storage/v1/object/business-images/${objectPath}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: file,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.message ? ` ${body.message}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`Isletme gorseli yuklenemedi.${detail}`);
  }

  return `${url}/storage/v1/object/public/business-images/${objectPath}`;
}

export function isBusinessSubscriptionActive(
  business: Pick<
    Business,
    "subscriptionStatus" | "subscriptionStartedAt" | "subscriptionExpiresAt" | "isActive"
  >,
) {
  if (!business.isActive) return false;
  if (business.subscriptionStatus !== "active") return false;
  if (!business.subscriptionExpiresAt) return false;

  const expiresAt = new Date(business.subscriptionExpiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;

  return Math.ceil((expiresAt - Date.now()) / dayMs) > 0;
}

export async function fetchProductsByBusinessId(
  _businessId: string,
  accessToken?: string,
) {
  const response = await fetch("/api/business/products", {
    headers: {
      Authorization: `Bearer ${accessToken || ""}`,
    },
  });
  const body = (await parseApiResponse(response)) as {
    products?: SupabaseProductRow[];
  };
  return (body.products ?? []).map(mapProduct);
}

export async function fetchPublicProductsByBusinessId(businessId: string) {
  const { url } = getSupabaseConfig();
  const response = await fetchWithTimeout(
    `${url}/rest/v1/products?business_id=eq.${encodeURIComponent(
      businessId,
    )}&is_active=eq.true&select=${publicProductSelect}&order=sort_order.asc,id.asc`,
    {
      headers: authHeaders(),
    },
  );
  const body = (await parseResponse(response)) as SupabasePublicProductRow[];
  return body.map(mapPublicProduct);
}

export async function fetchPublicProductsByBusinessSlug(slug: string) {
  const { url } = getSupabaseConfig();
  const businessResponse = await fetchWithTimeout(
    `${url}/rest/v1/businesses?slug=eq.${encodeURIComponent(
      slug,
    )}&select=id&limit=1`,
    {
      headers: authHeaders(),
    },
  );
  const businessBody = (await parseResponse(businessResponse)) as Array<{
    id: string;
  }>;
  const businessId = businessBody[0]?.id;

  if (!businessId) return [];

  return fetchPublicProductsByBusinessId(businessId);
}

function productApiInput(input: ProductInput) {
  return {
    name: input.name,
    price: Number(input.price),
    description: input.description?.trim() || "",
    category: input.category?.trim() || "Genel",
    imageLabel: input.imageLabel?.trim() || "",
    imageUrl: input.imageUrl?.trim() || null,
    isActive: typeof input.isActive === "boolean" ? input.isActive : true,
    sortOrder: Number(input.sortOrder ?? 0),
  };
}

export async function createProduct(input: ProductInput, accessToken: string) {
  const response = await fetch("/api/business/products", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: productApiInput(input),
    }),
  });
  const body = (await parseApiResponse(response)) as {
    product?: SupabaseProductRow;
  };
  if (!body.product) {
    throw new Error("Urun olusturuldu ancak kayit bilgisi donmedi.");
  }
  return mapProduct(body.product);
}

export async function updateProduct(
  productId: string,
  input: Partial<ProductInput>,
  accessToken: string,
) {
  const payload: Record<string, string | number | boolean | null> = {};

  if ("name" in input && input.name !== undefined) payload.name = input.name.trim();
  if ("price" in input && input.price !== undefined) {
    payload.price = Number(input.price);
  }
  if ("description" in input) payload.description = input.description?.trim() || "";
  if ("category" in input) payload.category = input.category?.trim() || "Genel";
  if ("imageLabel" in input) payload.imageLabel = input.imageLabel?.trim() ?? "";
  if ("imageUrl" in input) payload.imageUrl = input.imageUrl?.trim() || null;
  if ("isActive" in input && input.isActive !== undefined) {
    payload.isActive = input.isActive;
  }
  if ("sortOrder" in input && input.sortOrder !== undefined) {
    payload.sortOrder = Number(input.sortOrder || 0);
  }

  const response = await fetch(`/api/business/products/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: payload }),
  });
  const body = (await parseApiResponse(response)) as {
    product?: SupabaseProductRow;
  };
  return body.product ? mapProduct(body.product) : null;
}

export async function deleteProduct(productId: string, accessToken: string) {
  const response = await fetch(`/api/business/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  await parseApiResponse(response);
}

export async function setProductActiveStatus(
  productId: string,
  isActive: boolean,
  accessToken: string,
) {
  return updateProduct(productId, { isActive }, accessToken);
}

export async function reorderProducts(
  items: Array<{ productId: string; sortOrder: number }>,
  accessToken: string,
) {
  const response = await fetch("/api/business/products/reorder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
  });
  const body = (await parseApiResponse(response)) as {
    products?: SupabaseProductRow[];
  };
  return (body.products ?? []).map(mapProduct);
}
