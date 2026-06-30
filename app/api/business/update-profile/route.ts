import { NextResponse } from "next/server";

type SupabaseUser = {
  id: string;
  email?: string;
};

type BusinessProfileRequest = {
  businessId?: unknown;
  input?: Record<string, unknown>;
};

const allowedProfileFields = [
  "name",
  "description",
  "whatsapp_order_number",
  "city",
  "district",
  "neighborhood",
  "address",
  "delivery_status",
  "minimum_order_amount",
  "preparation_time_minutes",
  "is_open",
  "order_note",
  "service_radius_km",
  "logo_url",
  "cover_image_url",
] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const forbiddenFields = new Set([
  "id",
  "owner_id",
  "ownerId",
  "user_id",
  "userId",
  "slug",
  "subscription_status",
  "subscriptionStatus",
  "subscription_started_at",
  "subscriptionStartedAt",
  "subscription_expires_at",
  "subscriptionExpiresAt",
  "is_active",
  "isActive",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "deliveryStatus",
  "logo_text",
  "logoText",
  "latitude",
  "longitude",
]);

type ProfileUpdatePayload = Partial<
  Record<(typeof allowedProfileFields)[number], boolean | string | number | null>
>;

function jsonError(message: string, status = 400, detail?: unknown) {
  return NextResponse.json({ error: message, detail }, { status });
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

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const [type, token] = header.split(" ");

  if (type.toLowerCase() !== "bearer" || !token?.trim()) return "";
  return token.trim();
}

async function getUserFromToken(url: string, anonKey: string, accessToken: string) {
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const body = await readJson(response);

  if (!response.ok || !body?.id) {
    return null;
  }

  return body as SupabaseUser;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoForbiddenFields(record: Record<string, unknown>) {
  const found = Object.keys(record).filter((key) => forbiddenFields.has(key));
  if (found.length > 0) {
    throw new Error(`Bu alanlar profil guncellemesinde kullanilamaz: ${found.join(", ")}`);
  }
}

function addNullableStringField(
  payload: ProfileUpdatePayload,
  input: Record<string, unknown>,
  key: Extract<
    (typeof allowedProfileFields)[number],
    | "name"
    | "description"
    | "whatsapp_order_number"
    | "city"
    | "district"
    | "neighborhood"
    | "address"
    | "logo_url"
    | "cover_image_url"
  >,
) {
  if (!(key in input)) return;

  const value = input[key];
  if (value === null) {
    payload[key] = null;
    return;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} alani metin olmalidir.`);
  }

  payload[key] = value.trim();
}

function addLimitedStringField(
  payload: ProfileUpdatePayload,
  input: Record<string, unknown>,
  key: Extract<(typeof allowedProfileFields)[number], "delivery_status" | "order_note">,
  maxLength: number,
  label: string,
) {
  if (!(key in input)) return;

  const value = input[key];
  if (value === null) {
    payload[key] = null;
    return;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} metin olmalidir.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${label} en fazla ${maxLength} karakter olabilir.`);
  }
  payload[key] = trimmed || null;
}

function addNullableNumberField(
  payload: ProfileUpdatePayload,
  input: Record<string, unknown>,
  key: Extract<
    (typeof allowedProfileFields)[number],
    "service_radius_km" | "minimum_order_amount"
  >,
  label: string,
  minValue: number,
) {
  if (!(key in input)) return;

  const value = input[key];
  if (value === null) {
    payload[key] = null;
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < minValue) {
    throw new Error(`${label} gecerli bir sayi olmalidir.`);
  }
  payload[key] = value;
}

function buildProfilePayload(input: Record<string, unknown>) {
  assertNoForbiddenFields(input);

  const payload: ProfileUpdatePayload = {};
  addNullableStringField(payload, input, "name");
  addNullableStringField(payload, input, "description");
  addNullableStringField(payload, input, "whatsapp_order_number");
  addNullableStringField(payload, input, "city");
  addNullableStringField(payload, input, "district");
  addNullableStringField(payload, input, "neighborhood");
  addNullableStringField(payload, input, "address");
  addNullableStringField(payload, input, "logo_url");
  addNullableStringField(payload, input, "cover_image_url");
  addLimitedStringField(payload, input, "delivery_status", 120, "Teslimat bilgisi");
  addLimitedStringField(payload, input, "order_note", 300, "Siparis notu");

  addNullableNumberField(
    payload,
    input,
    "service_radius_km",
    "service_radius_km alani",
    0,
  );
  addNullableNumberField(
    payload,
    input,
    "minimum_order_amount",
    "Minimum siparis tutari",
    0,
  );

  if ("preparation_time_minutes" in input) {
    const value = input.preparation_time_minutes;
    if (value === null) {
      payload.preparation_time_minutes = null;
    } else if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 720
    ) {
      payload.preparation_time_minutes = value;
    } else {
      throw new Error("Hazirlik suresi 1 ile 720 dakika arasinda tam sayi olmalidir.");
    }
  }

  if ("is_open" in input) {
    const value = input.is_open;
    if (typeof value !== "boolean") {
      throw new Error("Siparis durumu acik veya kapali olarak secilmelidir.");
    }
    payload.is_open = value;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error("Guncellenecek profil alani bulunamadi.");
  }

  return payload;
}

async function fetchOwnedBusiness(
  url: string,
  serviceRoleKey: string,
  businessId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(
      businessId,
    )}&select=id,owner_id&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Isletme bilgisi alinamadi", body));
  }

  return Array.isArray(body) ? body[0] : null;
}

async function updateBusinessProfile(
  url: string,
  serviceRoleKey: string,
  businessId: string,
  payload: ProfileUpdatePayload,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(businessId)}&select=*`,
    {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Isletme profili guncellenemedi", body));
  }

  const business = Array.isArray(body) ? body[0] : body;
  if (!business?.id) {
    throw new Error("Isletme profili guncellendi ancak guncel kayit donmedi.");
  }

  return business;
}

export async function POST(request: Request) {
  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return jsonError("Oturum bulunamadi.", 401);
    }

    let body: BusinessProfileRequest;
    try {
      body = (await request.json()) as BusinessProfileRequest;
    } catch {
      return jsonError("Gecersiz istek govdesi.", 400);
    }

    if (!isPlainObject(body)) {
      return jsonError("Gecersiz istek govdesi.", 400);
    }

    if (typeof body.businessId !== "string" || !body.businessId.trim()) {
      return jsonError("Isletme ID bilgisi eksik veya gecersiz.", 400);
    }
    if (!isPlainObject(body.input)) {
      return jsonError("Profil bilgileri eksik veya gecersiz.", 400);
    }

    const businessId = body.businessId.trim();
    if (!UUID_PATTERN.test(businessId)) {
      return jsonError("Gecersiz businessId.", 400);
    }
    assertNoForbiddenFields(body as Record<string, unknown>);
    assertNoForbiddenFields(body.input);

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return jsonError("Gecersiz veya suresi dolmus oturum.", 401);
    }
    const business = await fetchOwnedBusiness(
      url,
      serviceRoleKey,
      businessId,
    );

    if (!business) {
      return jsonError("Isletme bulunamadi.", 404);
    }
    if (business.owner_id !== user.id) {
      return jsonError("Bu isletmeyi guncelleme yetkiniz yok.", 403);
    }

    const payload = buildProfilePayload(body.input);
    const updatedBusiness = await updateBusinessProfile(
      url,
      serviceRoleKey,
      businessId,
      payload,
    );

    return NextResponse.json({ business: updatedBusiness });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Isletme profili guncellenemedi.";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError(message, status);
  }
}
