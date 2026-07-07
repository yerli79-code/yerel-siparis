import { NextResponse } from "next/server";

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

function jsonError(message: string, status = 400, detail?: unknown) {
  return NextResponse.json({ message, detail }, { status });
}

function getSupabaseServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase public ortam değişkenleri eksik.");
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

async function createOwnerUser(
  url: string,
  serviceRoleKey: string,
  email: string,
  password: string,
) {
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
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

async function checkSlugAvailability(
  url: string,
  serviceRoleKey: string,
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
    throw new Error(safeSupabaseError("Slug kontrolü yapılamadı", body));
  }
  if (Array.isArray(body) && body.length > 0) {
    throw new Error("Bu slug zaten kullanılıyor.");
  }
}

async function deleteOwnerUser(url: string, serviceRoleKey: string, userId: string) {
  const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) {
    throw new Error("Oluşturulan Auth kullanıcısı geri silinemedi.");
  }
}

async function upsertProfile(
  url: string,
  serviceRoleKey: string,
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
    const response = await fetch(
      `${url}/rest/v1/profiles?on_conflict=id&select=*`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
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

async function deleteProfile(url: string, serviceRoleKey: string, userId: string) {
  const response = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Oluşturulan profil kaydı geri silinemedi.");
  }
}

async function createBusiness(
  url: string,
  serviceRoleKey: string,
  payload: CreateBusinessPayload,
  ownerId: string,
) {
  const subscriptionStatus = payload.subscriptionStatus || "active";
  const response = await fetch(`${url}/rest/v1/businesses?select=*`, {
    method: "POST",
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
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const adminToken = getAdminToken(request);

    if (!adminToken) {
      return jsonError("Admin oturumu bulunamadı.", 401);
    }

    const hasAdminAccess = await verifyAdminAccess(url, anonKey, adminToken);
    if (!hasAdminAccess) {
      return jsonError("Bu hesap admin yetkisine sahip değil.", 403);
    }

    const payload = (await request.json()) as CreateBusinessPayload;
    const email = payload.ownerEmail?.trim();
    const password = payload.temporaryPassword || "";

    if (!payload.name?.trim() || !payload.slug?.trim()) {
      return jsonError("İşletme adı ve slug zorunludur.");
    }
    if (!payload.whatsappOrderNumber?.trim()) {
      return jsonError("WhatsApp sipariş numarası zorunludur.");
    }
    if (!email) {
      return jsonError("İşletme sahibi e-posta alanı zorunludur.");
    }
    if (password.length < 6) {
      return jsonError("Geçici şifre en az 6 karakter olmalıdır.");
    }

    await checkSlugAvailability(url, serviceRoleKey, payload.slug.trim());

    const ownerId = await createOwnerUser(url, serviceRoleKey, email, password);

    try {
      await upsertProfile(
        url,
        serviceRoleKey,
        ownerId,
        email,
        payload.name.trim(),
      );
      const business = await createBusiness(url, serviceRoleKey, payload, ownerId);
      return NextResponse.json({ business });
    } catch (error) {
      let rollbackMessage = "";
      try {
        await deleteProfile(url, serviceRoleKey, ownerId);
      } catch {
        rollbackMessage +=
          " Oluşturulan profil kaydı otomatik geri silinemedi; Supabase profiles tablosunu manuel kontrol edin.";
      }
      try {
        await deleteOwnerUser(url, serviceRoleKey, ownerId);
      } catch {
        rollbackMessage +=
          " Oluşturulan Auth kullanıcısı otomatik geri silinemedi; Supabase Auth üzerinden manuel kontrol edin.";
      }
      const message =
        error instanceof Error ? error.message : "İşletme kaydı oluşturulamadı.";
      throw new Error(`${message}${rollbackMessage}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError("İşletme kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.", status);
  }
}
