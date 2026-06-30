import type { Business } from "./businesses";

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
  return text ? JSON.parse(text) : null;
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
  const mismatches: string[] = [];

  if (row.subscription_status !== payload.subscription_status) {
    mismatches.push(
      `subscription_status beklenen=${payload.subscription_status} gelen=${row.subscription_status}`,
    );
  }

  if (row.is_active !== payload.is_active) {
    mismatches.push(`is_active beklenen=${payload.is_active} gelen=${row.is_active}`);
  }

  if (
    nullableDateKey(row.subscription_started_at) !==
    nullableDateKey(payload.subscription_started_at)
  ) {
    mismatches.push(
      `subscription_started_at beklenen=${payload.subscription_started_at} gelen=${row.subscription_started_at}`,
    );
  }

  if (
    nullableDateKey(row.subscription_expires_at) !==
    nullableDateKey(payload.subscription_expires_at)
  ) {
    mismatches.push(
      `subscription_expires_at beklenen=${payload.subscription_expires_at} gelen=${row.subscription_expires_at}`,
    );
  }

  if (mismatches.length > 0) {
    throw new Error(
      JSON.stringify(
        {
          message:
            "Supabase update sonrasi SELECT eski veya beklenmeyen abonelik degerleri dondurdu.",
          mismatches,
          selectedRow: row,
        },
        null,
        2,
      ),
    );
  }
}

export async function fetchAdminBusinessesFromSupabase(
  fallbackBusinesses: Business[] = [],
  accessToken: string,
): Promise<Business[]> {
  const adminToken = accessToken.trim();
  if (!adminToken) {
    throw new Error("Admin oturumu bulunamadi. Lutfen tekrar giris yapin.");
  }

  const response = await fetch("/api/admin/list-businesses", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    const fullError = formatSupabaseError(response.status, body);
    console.error("Supabase businesses fetch error", fullError);
    throw new Error(fullError);
  }

  const rows: SupabaseBusinessRow[] = Array.isArray(body)
    ? (body as SupabaseBusinessRow[])
    : Array.isArray(body?.businesses)
      ? (body.businesses as SupabaseBusinessRow[])
      : [];

  const fallbackBySlug = new Map(
    fallbackBusinesses.map((business) => [business.slug, business]),
  );

  const mappedBusinesses = rows.map((row: SupabaseBusinessRow) =>
    mergeSupabaseBusiness(row, fallbackBySlug.get(row.slug)),
  );

  return mappedBusinesses;
}

export async function createBusinessWithAccount(
  input: AdminCreateBusinessInput,
  accessToken: string,
) {
  const adminToken = accessToken.trim();
  if (!adminToken) {
    throw new Error("Admin oturumu bulunamadı. Lütfen tekrar giriş yapın.");
  }

  const response = await fetch("/api/admin/create-business", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    const message =
      body?.message || body?.error || formatSupabaseError(response.status, body);
    const detail =
      typeof body?.detail === "string"
        ? `\n${body.detail}`
        : body?.detail
          ? `\n${JSON.stringify(body.detail, null, 2)}`
          : "";
    throw new Error(`${message}${detail}`);
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
  accessToken: string,
): Promise<DeleteBusinessResult> {
  const adminToken = accessToken.trim();
  if (!adminToken) {
    throw new Error("Admin oturumu bulunamadı. Lütfen tekrar giriş yapın.");
  }
  if (!businessId.trim()) {
    throw new Error("Silinecek işletme ID bilgisi eksik.");
  }

  const response = await fetch("/api/admin/delete-business", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ businessId }),
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    const message =
      body?.message || body?.error || formatSupabaseError(response.status, body);
    throw new Error(message);
  }

  return {
    deleted: Boolean(body?.deleted),
    notFound: Boolean(body?.notFound),
    message: body?.message,
  };
}

export async function updateBusinessInSupabase(
  input: AdminUpdateBusinessInput,
  accessToken: string,
) {
  const adminToken = accessToken.trim();
  if (!adminToken) {
    throw new Error("Admin oturumu bulunamadi. Lutfen tekrar giris yapin.");
  }
  if (!input.id.trim()) {
    throw new Error("Guncellenecek isletme ID bilgisi eksik.");
  }

  const response = await fetch("/api/admin/update-business", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  const body = parseSupabaseBody(text);

  if (!response.ok) {
    const message =
      body?.message || body?.error || formatSupabaseError(response.status, body);
    const detail =
      typeof body?.detail === "string"
        ? `\n${body.detail}`
        : body?.detail
          ? `\n${JSON.stringify(body.detail, null, 2)}`
          : "";
    throw new Error(`${message}${detail}`);
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
  accessToken: string,
) {
  const adminToken = accessToken.trim();
  if (!adminToken) {
    throw new Error("Admin oturumu bulunamadi. Lutfen tekrar giris yapin.");
  }

  const response = await fetch("/api/admin/update-subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
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
    const message =
      body?.message || body?.error || formatSupabaseError(response.status, body);
    const detail =
      typeof body?.detail === "string"
        ? `\n${body.detail}`
        : body?.detail
          ? `\n${JSON.stringify(body.detail, null, 2)}`
          : "";
    throw new Error(`${message}${detail}`);
  }

  const selectedRow = body?.business as SupabaseBusinessRow | undefined;

  if (!selectedRow?.slug) {
    throw new Error(
      JSON.stringify(
        {
          message:
            "Supabase update sonrasi guncellenen business kaydi donmedi.",
          slug: business.slug,
          body,
        },
        null,
        2,
      ),
    );
  }

  verifySubscriptionUpdate(selectedRow, payload);

  return mergeSupabaseBusiness(selectedRow, business);
}
