import "server-only";

import { cache } from "react";
import type { Business } from "./businesses";
import { getPaymentMethodModeOrDefault } from "./payment-methods";

type PublicBusinessRow = {
  id: string;
  slug: string;
  name: string | null;
  description: string | null;
  whatsapp_order_number: string | null;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  address: string | null;
  delivery_status: string | null;
  payment_method_mode: string | null;
  minimum_order_amount: number | string | null;
  preparation_time_minutes: number | null;
  is_open: boolean | null;
  order_note: string | null;
  logo_text: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  subscription_status: "active" | "expired" | "blocked" | null;
  subscription_expires_at: string | null;
  is_active: boolean | null;
};

export type PublicBusiness = Business & {
  id: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
};

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

const publicBusinessRequestTimeoutMs = 9000;

function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Public işletme sorgusu için Supabase yapılandırması eksik.",
    );
  }

  return { url: url.replace(/\/$/, ""), anonKey };
}

function toNullableNumber(value: number | string | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapPublicBusiness(row: PublicBusinessRow): PublicBusiness {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name ?? row.slug,
    description: row.description ?? "",
    whatsappOrderNumber: row.whatsapp_order_number ?? "",
    email: "",
    createdAt: "",
    category: "",
    city: row.city ?? "",
    district: row.district ?? "",
    neighborhood: row.neighborhood ?? "",
    address: row.address ?? "",
    deliveryStatus: row.delivery_status ?? "",
    paymentMethodMode: getPaymentMethodModeOrDefault(row.payment_method_mode),
    minimumOrderAmount: toNullableNumber(row.minimum_order_amount),
    preparationTimeMinutes: row.preparation_time_minutes,
    isOpen: row.is_open ?? true,
    orderNote: row.order_note,
    logoText: row.logo_text ?? "",
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    subscriptionStatus: row.subscription_status ?? "expired",
    subscriptionStartedAt: null,
    subscriptionExpiresAt: row.subscription_expires_at,
    isActive: row.is_active ?? false,
    productCategories: [],
  };
}

async function fetchPublicBusinessBySlug(
  slug: string,
): Promise<PublicBusiness | null> {
  const { url, anonKey } = getPublicSupabaseConfig();
  const requestUrl = new URL(`${url}/rest/v1/businesses`);
  requestUrl.searchParams.set("slug", `eq.${slug}`);
  requestUrl.searchParams.set("select", publicBusinessSelect);
  requestUrl.searchParams.set("limit", "1");

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    publicBusinessRequestTimeoutMs,
  );

  let response: Response;

  try {
    response = await fetch(requestUrl, {
      cache: "no-store",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error("Public işletme sorgusu tamamlanamadı.", {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `Public işletme sorgusu ${response.status} durum koduyla başarısız oldu.`,
    );
  }

  let rows: PublicBusinessRow[];

  try {
    rows = (await response.json()) as PublicBusinessRow[];
  } catch (error) {
    throw new Error("Public işletme sorgusu geçersiz bir yanıt döndürdü.", {
      cause: error,
    });
  }

  const row = rows[0];
  return row ? mapPublicBusiness(row) : null;
}

export const getPublicBusinessBySlug = cache(fetchPublicBusinessBySlug);
