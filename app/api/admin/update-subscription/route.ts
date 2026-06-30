import { NextResponse } from "next/server";

type SubscriptionPayload = {
  businessId?: string;
  slug?: string;
  subscription_status?: "active" | "expired" | "blocked";
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
  is_active?: boolean;
};

function jsonError(message: string, status = 400, detail?: unknown) {
  return NextResponse.json({ message, detail }, { status });
}

function getSupabaseServerConfig() {
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

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function safeSupabaseError(prefix: string, body: unknown) {
  const error = body as {
    code?: string;
    message?: string;
    details?: string;
    hint?: string;
    error?: string;
    error_description?: string;
  } | null;
  const parts = [
    error?.message || error?.error_description || error?.error,
    error?.code ? `Kod: ${error.code}` : "",
    error?.details ? `Detay: ${error.details}` : "",
    error?.hint ? `Ipucu: ${error.hint}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? `${prefix}: ${parts.join(" | ")}` : prefix;
}

function getAdminToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const [type, token] = header.split(" ");

  if (type.toLowerCase() !== "bearer" || !token?.trim()) return "";
  return token.trim();
}

async function verifyAdminAccess(url: string, anonKey: string, adminToken: string) {
  const response = await fetch(
    `${url}/rest/v1/admin_users?is_active=eq.true&select=id,email,is_active&limit=1`,
    {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${adminToken}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok || !Array.isArray(body)) return false;
  return body.length > 0;
}

function nullableDateKey(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function verifySubscriptionUpdate(row: SubscriptionPayload, payload: SubscriptionPayload) {
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
        },
        null,
        2,
      ),
    );
  }
}

async function updateSubscription(
  url: string,
  serviceRoleKey: string,
  payload: Required<Pick<SubscriptionPayload, "subscription_status" | "is_active">> &
    Pick<
      SubscriptionPayload,
      "businessId" | "slug" | "subscription_started_at" | "subscription_expires_at"
    >,
) {
  const filter = payload.businessId?.trim()
    ? `id=eq.${encodeURIComponent(payload.businessId.trim())}`
    : `slug=eq.${encodeURIComponent(payload.slug?.trim() || "")}`;

  const response = await fetch(`${url}/rest/v1/businesses?${filter}&select=*`, {
    method: "PATCH",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      subscription_status: payload.subscription_status,
      subscription_started_at: payload.subscription_started_at ?? null,
      subscription_expires_at: payload.subscription_expires_at ?? null,
      is_active: payload.is_active,
      updated_at: new Date().toISOString(),
    }),
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Abonelik guncellenemedi", body));
  }

  const business = Array.isArray(body) ? body[0] : body;
  if (!business?.slug) {
    throw new Error("Abonelik guncellendi ancak isletme kaydi donmedi.");
  }

  return business;
}

export async function POST(request: Request) {
  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const adminToken = getAdminToken(request);

    if (!adminToken) {
      return jsonError("Admin oturumu bulunamadi.", 401);
    }

    const hasAdminAccess = await verifyAdminAccess(url, anonKey, adminToken);
    if (!hasAdminAccess) {
      return jsonError("Bu hesap admin yetkisine sahip degil.", 403);
    }

    const payload = (await request.json()) as SubscriptionPayload;
    if (!payload.businessId?.trim() && !payload.slug?.trim()) {
      return jsonError("Guncellenecek isletme ID veya slug bilgisi eksik.");
    }
    if (
      payload.subscription_status !== "active" &&
      payload.subscription_status !== "expired" &&
      payload.subscription_status !== "blocked"
    ) {
      return jsonError("Gecersiz abonelik durumu.");
    }
    if (typeof payload.is_active !== "boolean") {
      return jsonError("Aktif/pasif bilgisi gecersiz.");
    }

    const business = await updateSubscription(url, serviceRoleKey, {
      businessId: payload.businessId,
      slug: payload.slug,
      subscription_status: payload.subscription_status,
      subscription_started_at: payload.subscription_started_at ?? null,
      subscription_expires_at: payload.subscription_expires_at ?? null,
      is_active: payload.is_active,
    });

    verifySubscriptionUpdate(business, payload);

    return NextResponse.json({ business });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Abonelik guncellenemedi.";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError(message, status);
  }
}
