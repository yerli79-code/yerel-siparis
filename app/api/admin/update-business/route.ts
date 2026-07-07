import { NextResponse } from "next/server";
import {
  hasBusinessLocationChanged,
  isValidStandardBusinessLocation,
  type BusinessLocationInput,
} from "../../../../lib/locations/server";

type UpdateBusinessPayload = {
  id?: string;
  slug?: string;
  name?: string;
  description?: string;
  whatsappOrderNumber?: string;
  city?: string;
  district?: string;
  neighborhood?: string;
  address?: string;
  subscriptionStatus?: "active" | "expired" | "blocked";
  subscriptionStartedAt?: string | null;
  subscriptionExpiresAt?: string | null;
  isActive?: boolean;
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

function safeSupabaseError(prefix: string, _body: unknown) {
  return prefix;
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

async function ensureSlugIsAvailable(
  url: string,
  serviceRoleKey: string,
  businessId: string,
  slug: string,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Slug kontrolu yapilamadi", body));
  }

  const existingId = Array.isArray(body) ? body[0]?.id : null;
  if (existingId && existingId !== businessId) {
    throw new Error("Bu slug baska bir isletme tarafindan kullaniliyor.");
  }
}

async function fetchCurrentBusinessLocation(
  url: string,
  serviceRoleKey: string,
  businessId: string,
): Promise<BusinessLocationInput | null> {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(
      businessId,
    )}&select=city,district,neighborhood&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Isletme konumu kontrol edilemedi", body));
  }

  const row = Array.isArray(body) ? body[0] : null;
  if (!row) return null;
  return {
    city: row.city ?? "",
    district: row.district ?? "",
    neighborhood: row.neighborhood ?? "",
  };
}

async function updateBusiness(
  url: string,
  serviceRoleKey: string,
  payload: UpdateBusinessPayload,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(payload.id || "")}&select=*`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        slug: payload.slug,
        name: payload.name,
        description: payload.description || "",
        whatsapp_order_number: payload.whatsappOrderNumber || "",
        city: payload.city || "",
        district: payload.district || "",
        neighborhood: payload.neighborhood || "",
        address: payload.address || "",
        subscription_status: payload.subscriptionStatus || "expired",
        subscription_started_at: payload.subscriptionStartedAt || null,
        subscription_expires_at: payload.subscriptionExpiresAt || null,
        is_active: typeof payload.isActive === "boolean" ? payload.isActive : false,
      }),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Isletme kaydi guncellenemedi", body));
  }

  const updatedBusiness = Array.isArray(body) ? body[0] : body;
  if (!updatedBusiness?.slug) {
    throw new Error("Isletme kaydi guncellendi ancak kayit bilgisi donmedi.");
  }

  return updatedBusiness;
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

    const payload = (await request.json()) as UpdateBusinessPayload;
    const businessId = payload.id?.trim();
    const slug = payload.slug?.trim();

    if (!businessId) {
      return jsonError("Guncellenecek isletme ID bilgisi eksik.");
    }
    if (!payload.name?.trim() || !slug) {
      return jsonError("Isletme adi ve slug zorunludur.");
    }
    if (!payload.whatsappOrderNumber?.trim()) {
      return jsonError("WhatsApp siparis numarasi zorunludur.");
    }

    const currentLocation = await fetchCurrentBusinessLocation(
      url,
      serviceRoleKey,
      businessId,
    );
    const nextLocation = {
      city: payload.city ?? "",
      district: payload.district ?? "",
      neighborhood: payload.neighborhood ?? "",
    };
    if (
      (!currentLocation || hasBusinessLocationChanged(currentLocation, nextLocation)) &&
      !(await isValidStandardBusinessLocation(nextLocation))
    ) {
      return jsonError("Lütfen geçerli il, ilçe ve Mahalle / Köy seçin.");
    }

    await ensureSlugIsAvailable(url, serviceRoleKey, businessId, slug);
    const business = await updateBusiness(url, serviceRoleKey, {
      ...payload,
      id: businessId,
      slug,
      name: payload.name.trim(),
    });

    return NextResponse.json({ business });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError("İşletme kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.", status);
  }
}
