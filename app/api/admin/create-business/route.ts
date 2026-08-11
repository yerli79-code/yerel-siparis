import { isValidStandardBusinessLocation } from "../../../../lib/locations/server";
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

type CreateBusinessPayload = {
  slug?: string;
  name?: string;
  description?: string;
  whatsappOrderNumber?: string;
  city?: string;
  district?: string;
  neighborhood?: string;
  address?: string;
  ownerEmail?: string;
  temporaryPassword?: string;
  subscriptionStatus?: "active" | "expired" | "blocked";
  subscriptionStartedAt?: string | null;
  subscriptionExpiresAt?: string | null;
  isActive?: boolean;
};

type SupabaseUserResponse = {
  id?: string;
  user?: {
    id?: string;
  };
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

async function createOwnerUser(email: string, password: string) {
  const response = await adminServiceFetch("/auth/v1/admin/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });
  const body = (await readJson(response)) as SupabaseUserResponse | null;

  if (!response.ok) {
    const message =
      response.status === 422 || response.status === 400
        ? "Bu e-posta ile daha önce kullanıcı oluşturulmuş."
        : safeSupabaseError("İşletme sahibi giriş hesabı oluşturulamadı", body);
    throw new Error(message);
  }

  const userId = body?.id || body?.user?.id;
  if (!userId) {
    throw new Error("İşletme sahibi kullanıcı ID bilgisi alınamadı.");
  }

  return userId;
}

async function checkSlugAvailability(slug: string) {
  const response = await adminServiceFetch(
    `/rest/v1/businesses?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Slug kontrolü yapılamadı", body));
  }
  if (Array.isArray(body) && body.length > 0) {
    throw new Error("Bu slug zaten kullanılıyor.");
  }
}

async function deleteOwnerUser(userId: string) {
  const response = await adminServiceFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("Oluşturulan Auth kullanıcısı geri silinemedi.");
  }
}

async function upsertProfile(
  userId: string,
  email: string,
  businessName: string,
) {
  const now = new Date().toISOString();
  const profilePayloads = [
    {
      id: userId,
      email,
      full_name: businessName,
      created_at: now,
      updated_at: now,
    },
    {
      id: userId,
      email,
      name: businessName,
      created_at: now,
      updated_at: now,
    },
    {
      id: userId,
      email,
      full_name: businessName,
    },
    {
      id: userId,
      email,
    },
    {
      id: userId,
    },
  ];
  let lastError = "Profil kaydı oluşturulamadı.";

  for (const profilePayload of profilePayloads) {
    const response = await adminServiceFetch(
      "/rest/v1/profiles?on_conflict=id&select=id",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(profilePayload),
      },
    );
    const body = await readJson(response);

    if (response.ok) return;

    lastError = safeSupabaseError("Profil kaydı oluşturulamadı", body);
    if ((body as { code?: string } | null)?.code !== "PGRST204") {
      throw new Error(lastError);
    }
  }

  throw new Error(lastError);
}

async function deleteProfile(userId: string) {
  const response = await adminServiceFetch(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error("Oluşturulan profil kaydı geri silinemedi.");
  }
}

async function createBusiness(
  payload: CreateBusinessPayload,
  ownerId: string,
) {
  const subscriptionStatus = payload.subscriptionStatus || "active";
  const response = await adminServiceFetch("/rest/v1/businesses?select=id,owner_id,slug,name,description,whatsapp_order_number,created_at,category,city,district,neighborhood,address,delivery_status,logo_text,subscription_status,subscription_started_at,subscription_expires_at,is_active", {
    method: "POST",
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
      owner_id: ownerId,
      subscription_status: subscriptionStatus,
      subscription_started_at: payload.subscriptionStartedAt || null,
      subscription_expires_at: payload.subscriptionExpiresAt || null,
      is_active: typeof payload.isActive === "boolean" ? payload.isActive : false,
    }),
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("İşletme kaydı oluşturulamadı", body));
  }

  const createdBusiness = Array.isArray(body) ? body[0] : body;
  if (!createdBusiness?.slug) {
    throw new Error("İşletme kaydı oluşturuldu ancak kayıt bilgisi dönmedi.");
  }

  return createdBusiness;
}

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    await requireAdmin();

    let payload: CreateBusinessPayload;
    try {
      payload = (await request.json()) as CreateBusinessPayload;
    } catch {
      invalidAdminRequest("Geçersiz istek gövdesi.");
    }
    const email = payload.ownerEmail?.trim();
    const password = payload.temporaryPassword || "";

    if (!payload.name?.trim() || !payload.slug?.trim()) {
      return jsonError("İşletme adı ve slug zorunludur.");
    }
    if (!payload.whatsappOrderNumber?.trim()) {
      return jsonError("WhatsApp sipariş numarası zorunludur.");
    }
    if (!(await isValidStandardBusinessLocation(payload))) {
      return jsonError("Lütfen geçerli il, ilçe ve Mahalle / Köy seçin.");
    }
    if (!email) {
      return jsonError("İşletme sahibi e-posta alanı zorunludur.");
    }
    if (password.length < 6) {
      return jsonError("Geçici şifre en az 6 karakter olmalıdır.");
    }

    await checkSlugAvailability(payload.slug.trim());

    const ownerId = await createOwnerUser(email, password);

    try {
      await upsertProfile(
        ownerId,
        email,
        payload.name.trim(),
      );
      const business = await createBusiness(payload, ownerId);
      return adminJson({ business });
    } catch (error) {
      let rollbackMessage = "";
      try {
        await deleteProfile(ownerId);
      } catch {
        rollbackMessage +=
          " Oluşturulan profil kaydı otomatik geri silinemedi; Supabase profiles tablosunu manuel kontrol edin.";
      }
      try {
        await deleteOwnerUser(ownerId);
      } catch {
        rollbackMessage +=
          " Oluşturulan Auth kullanıcısı otomatik geri silinemedi; Supabase Auth üzerinden manuel kontrol edin.";
      }
      const message =
        error instanceof Error ? error.message : "İşletme kaydı oluşturulamadı.";
      throw new Error(`${message}${rollbackMessage}`);
    }
  } catch (error) {
    return adminErrorResponse(error, "İşletme kaydedilemedi.");
  }
}
