export const ADMIN_BUSINESS_DETAIL_SELECT = [
  "id",
  "owner_id",
  "name",
  "slug",
  "created_at",
  "updated_at",
  "description",
  "category",
  "city",
  "district",
  "neighborhood",
  "address",
  "whatsapp_order_number",
  "delivery_status",
  "is_active",
  "is_open",
  "payment_method_mode",
  "minimum_order_amount",
  "preparation_time_minutes",
  "order_note",
  "logo_url",
  "cover_image_url",
  "subscription_status",
  "subscription_started_at",
  "subscription_expires_at",
].join(",");

export const ADMIN_ORDER_SUMMARY_SELECT = [
  "id",
  "business_order_number",
  "status",
  "order_type",
  "total_amount",
  "currency",
  "created_at",
].join(",");

export const ADMIN_RECENT_ORDER_LIMIT = 5;
export const ADMIN_BUSINESS_NAME_MAX_LENGTH = 160;
export const ADMIN_BUSINESS_SLUG_MAX_LENGTH = 100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_PATCH_KEYS = new Set([
  "name",
  "slug",
  "description",
  "category",
  "whatsappOrderNumber",
  "city",
  "district",
  "neighborhood",
  "address",
  "expectedUpdatedAt",
]);

export type AdminOrderSummary = {
  id: string;
  businessOrderNumber: number | string;
  status: string;
  orderType: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
};

export type AdminBusinessDetail = {
  business: {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
    description: string;
    category: string;
    city: string;
    district: string;
    neighborhood: string;
    address: string;
    whatsappOrderNumber: string;
    deliveryStatus: string;
    isActive: boolean;
    isOpen: boolean;
    paymentMethodMode: string;
    minimumOrderAmount: number | null;
    preparationTimeMinutes: number | null;
    orderNote: string | null;
    logoUrl: string | null;
    coverImageUrl: string | null;
    subscriptionStatus: "active" | "expired" | "blocked";
    subscriptionStartedAt: string | null;
    subscriptionExpiresAt: string | null;
  };
  owner: { email: string };
  counts: { products: number; orders: number };
  lastOrder: AdminOrderSummary | null;
  recentOrders: AdminOrderSummary[];
};

export type AdminBusinessSafePatch = {
  name: string;
  slug: string;
  description: string;
  category: string;
  whatsappOrderNumber: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  expectedUpdatedAt: string;
};

export type AdminBusinessSafePatchResult = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  whatsappOrderNumber: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  updatedAt: string;
};

export class AdminBusinessDetailContractError extends Error {}

export function isCanonicalUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function normalizeAdminBusinessSlug(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseAdminBusinessSafePatch(value: unknown): AdminBusinessSafePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminBusinessDetailContractError("Geçersiz istek gövdesi.");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== ALLOWED_PATCH_KEYS.size || keys.some((key) => !ALLOWED_PATCH_KEYS.has(key))) {
    throw new AdminBusinessDetailContractError(
      "Yalnızca güvenli işletme profil alanları ve güncelleme sürümü gönderilebilir.",
    );
  }

  if (typeof record.name !== "string") {
    throw new AdminBusinessDetailContractError("İşletme adı zorunludur.");
  }
  const name = record.name.trim();
  if (!name || name.length > ADMIN_BUSINESS_NAME_MAX_LENGTH) {
    throw new AdminBusinessDetailContractError(
      `İşletme adı 1-${ADMIN_BUSINESS_NAME_MAX_LENGTH} karakter olmalıdır.`,
    );
  }

  if (typeof record.slug !== "string") {
    throw new AdminBusinessDetailContractError("Slug zorunludur.");
  }
  const slug = normalizeAdminBusinessSlug(record.slug);
  if (!slug || slug.length > ADMIN_BUSINESS_SLUG_MAX_LENGTH) {
    throw new AdminBusinessDetailContractError(
      `Slug 1-${ADMIN_BUSINESS_SLUG_MAX_LENGTH} karakter olmalıdır.`,
    );
  }

  if (
    typeof record.expectedUpdatedAt !== "string" ||
    !record.expectedUpdatedAt.trim() ||
    !Number.isFinite(new Date(record.expectedUpdatedAt).getTime())
  ) {
    throw new AdminBusinessDetailContractError("Güncelleme sürümü geçersizdir.");
  }

  const optionalTextFields = [
    "description",
    "category",
    "city",
    "district",
    "neighborhood",
    "address",
  ] as const;
  const optionalText = Object.fromEntries(
    optionalTextFields.map((field) => {
      const rawValue = record[field];
      if (typeof rawValue !== "string") {
        throw new AdminBusinessDetailContractError(`${field} alanı metin olmalıdır.`);
      }
      return [field, rawValue.trim()];
    }),
  ) as Record<(typeof optionalTextFields)[number], string>;

  const requiredTextFields = [
    ["whatsappOrderNumber", "WhatsApp sipariş numarası"],
  ] as const;
  const requiredText = Object.fromEntries(
    requiredTextFields.map(([field, label]) => {
      const rawValue = record[field];
      if (typeof rawValue !== "string" || !rawValue.trim()) {
        throw new AdminBusinessDetailContractError(`${label} zorunludur.`);
      }
      return [field, rawValue.trim()];
    }),
  ) as Record<(typeof requiredTextFields)[number][0], string>;

  return {
    name,
    slug,
    ...optionalText,
    ...requiredText,
    expectedUpdatedAt: record.expectedUpdatedAt.trim(),
  };
}

export function buildAdminBusinessSafePatchParams(
  businessId: string,
  expectedUpdatedAt: string,
) {
  const params = new URLSearchParams();
  params.set("id", `eq.${businessId}`);
  params.set("updated_at", `eq.${expectedUpdatedAt}`);
  params.set(
    "select",
    "id,name,slug,description,category,whatsapp_order_number,city,district,neighborhood,address,updated_at",
  );
  return params;
}
