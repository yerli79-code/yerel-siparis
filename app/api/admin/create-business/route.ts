import { isValidStandardBusinessLocation } from "../../../../lib/locations/server";
import { requireAdmin } from "../../../../lib/admin/auth";
import {
  createBusinessWithAudit,
  reconcileBusinessCreation,
} from "../../../../lib/admin/business-creation";
import { AdminError } from "../../../../lib/admin/errors";
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
    throw new AdminError("DUPLICATE_SLUG", "Bu slug zaten kullanılıyor.", 409);
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

async function compensateOwner(ownerId: string, error: AdminError): Promise<never> {
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
  throw new AdminError(error.code, `${error.message}${rollbackMessage}`, error.status);
}

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    const actor = await requireAdmin();

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
    if (payload.subscriptionStatus && !["active", "expired", "blocked"].includes(payload.subscriptionStatus)) {
      return jsonError("Geçersiz abonelik durumu.");
    }

    await checkSlugAvailability(payload.slug.trim());

    const ownerId = await createOwnerUser(email, password);
    try {
      await upsertProfile(
        ownerId,
        email,
        payload.name.trim(),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Profil kaydı oluşturulamadı.";
      return await compensateOwner(ownerId, new AdminError("ADMIN_UNAVAILABLE", message, 503));
    }

    const businessId = crypto.randomUUID();
    const outcome = await createBusinessWithAudit({
      businessId,
      ownerId,
      slug: payload.slug.trim(),
      name: payload.name.trim(),
      description: payload.description || "",
      whatsappOrderNumber: payload.whatsappOrderNumber || "",
      city: payload.city || "",
      district: payload.district || "",
      neighborhood: payload.neighborhood || "",
      address: payload.address || "",
      subscriptionStatus: payload.subscriptionStatus || "active",
      subscriptionStartedAt: payload.subscriptionStartedAt || null,
      subscriptionExpiresAt: payload.subscriptionExpiresAt || null,
      isActive: typeof payload.isActive === "boolean" ? payload.isActive : false,
      actor,
    });
    if (outcome.kind === "success") return adminJson({ business: outcome.business });
    if (outcome.kind === "known-failure") {
      return await compensateOwner(ownerId, outcome.error);
    }

    const reconciled = await reconcileBusinessCreation(businessId);
    if (reconciled.kind === "committed") return adminJson({ business: reconciled.business });
    if (reconciled.kind === "not-committed") {
      return await compensateOwner(ownerId, new AdminError(
        "ADMIN_UNAVAILABLE", "İşletme kaydı oluşturulamadı.", 503,
      ));
    }
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşletme oluşturma sonucu doğrulanamadı. Hesapları silmeden manuel inceleme gereklidir.",
      503,
    );
  } catch (error) {
    return adminErrorResponse(error, "İşletme kaydedilemedi.");
  }
}
