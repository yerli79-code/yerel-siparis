import {
  hasBusinessLocationChanged,
  isValidStandardBusinessLocation,
  type BusinessLocationInput,
} from "../../../../lib/locations/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import {
  adminServiceFetch,
  readJsonBody as readJson,
} from "../../../../lib/admin/dal";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
  invalidAdminRequest,
} from "../../../../lib/admin/http";

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

function jsonError(message: string, status = 400) {
  return adminJson(
    { error: { code: "INVALID_REQUEST", message } },
    { status },
  );
}

function safeSupabaseError(prefix: string, _body: unknown) {
  return prefix;
}

async function ensureSlugIsAvailable(
  businessId: string,
  slug: string,
) {
  const response = await adminServiceFetch(
    `/rest/v1/businesses?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
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
  businessId: string,
): Promise<BusinessLocationInput | null> {
  const response = await adminServiceFetch(
    `/rest/v1/businesses?id=eq.${encodeURIComponent(
      businessId,
    )}&select=city,district,neighborhood&limit=1`,
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

async function updateBusiness(payload: UpdateBusinessPayload) {
  const response = await adminServiceFetch(
    `/rest/v1/businesses?id=eq.${encodeURIComponent(payload.id || "")}&select=id,owner_id,slug,name,description,whatsapp_order_number,created_at,category,city,district,neighborhood,address,delivery_status,logo_text,subscription_status,subscription_started_at,subscription_expires_at,is_active`,
    {
      method: "PATCH",
      headers: {
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
    assertSameOriginAdminMutation(request);
    await requireAdmin();

    let payload: UpdateBusinessPayload;
    try {
      payload = (await request.json()) as UpdateBusinessPayload;
    } catch {
      invalidAdminRequest("Geçersiz istek gövdesi.");
    }
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

    const currentLocation = await fetchCurrentBusinessLocation(businessId);
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

    await ensureSlugIsAvailable(businessId, slug);
    const business = await updateBusiness({
      ...payload,
      id: businessId,
      slug,
      name: payload.name.trim(),
    });

    return adminJson({ business });
  } catch (error) {
    return adminErrorResponse(error, "İşletme kaydedilemedi.");
  }
}
