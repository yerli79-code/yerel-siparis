import { privateBusinessJson } from "../_response";
import {
  hasBusinessLocationChanged,
  isValidStandardBusinessLocation,
  type BusinessLocationInput,
} from "../../../../lib/locations/server";
import { isPaymentMethodMode } from "../../../../lib/payment-methods";

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
  "payment_method_mode",
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

type OwnedBusinessRow = BusinessLocationInput & {
  id: string;
  owner_id: string;
};

class PublicRouteError extends Error {
  constructor(
    readonly publicMessage: string,
    readonly status = 400,
  ) {
    super(publicMessage);
  }
}

class ServerConfigError extends Error {}

function jsonError(message: string, status = 400, detail?: unknown) {
  return privateBusinessJson({ error: message, detail }, status);
}

function getSupabaseServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey) {
    throw new ServerConfigError();
  }
  if (!serviceRoleKey) {
    throw new ServerConfigError();
  }

  return { url, anonKey, serviceRoleKey };
}

async function readJson(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function safeSupabaseError(prefix: string) {
  return prefix;
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
    throw new PublicRouteError("Profil bilgileri gecersiz.", 400);
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
    throw new PublicRouteError("Profil bilgileri gecersiz.", 400);
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
    throw new PublicRouteError("Profil bilgileri gecersiz.", 400);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new PublicRouteError(`${label} en fazla ${maxLength} karakter olabilir.`, 400);
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
    throw new PublicRouteError(`${label} gecerli bir sayi olmalidir.`, 400);
  }
  payload[key] = value;
}

function addPaymentMethodModeField(
  payload: ProfileUpdatePayload,
  input: Record<string, unknown>,
) {
  if (!("payment_method_mode" in input)) return;

  const value = input.payment_method_mode;
  if (!isPaymentMethodMode(value)) {
    throw new PublicRouteError(
      "Lütfen geçerli bir ödeme kabul yöntemi seçin.",
      400,
    );
  }
  payload.payment_method_mode = value;
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
  addPaymentMethodModeField(payload, input);

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
      throw new PublicRouteError(
        "Hazirlik suresi 1 ile 720 dakika arasinda tam sayi olmalidir.",
        400,
      );
    }
  }

  if ("is_open" in input) {
    const value = input.is_open;
    if (typeof value !== "boolean") {
      throw new PublicRouteError("Siparis durumu acik veya kapali olarak secilmelidir.", 400);
    }
    payload.is_open = value;
  }

  if (Object.keys(payload).length === 0) {
    throw new PublicRouteError("Guncellenecek profil alani bulunamadi.", 400);
  }

  return payload;
}

async function fetchOwnedBusiness(
  url: string,
  serviceRoleKey: string,
  businessId: string,
): Promise<OwnedBusinessRow | null> {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(
      businessId,
    )}&select=id,owner_id,city,district,neighborhood&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(safeSupabaseError("Isletme bilgisi alinamadi"));
  }

  return Array.isArray(body) ? body[0] : null;
}

function getNextLocation(
  current: BusinessLocationInput,
  payload: ProfileUpdatePayload,
): BusinessLocationInput {
  return {
    city: "city" in payload ? (payload.city as string | null) : current.city,
    district:
      "district" in payload ? (payload.district as string | null) : current.district,
    neighborhood:
      "neighborhood" in payload
        ? (payload.neighborhood as string | null)
        : current.neighborhood,
  };
}

function hasNoLocation(input: BusinessLocationInput) {
  return !input.city?.trim() && !input.district?.trim() && !input.neighborhood?.trim();
}

function hasPartialLocation(input: BusinessLocationInput) {
  const filledCount = [input.city, input.district, input.neighborhood].filter(
    (value) => Boolean(value?.trim()),
  ).length;
  return filledCount > 0 && filledCount < 3;
}

async function validateLocationUpdate(
  current: BusinessLocationInput,
  payload: ProfileUpdatePayload,
) {
  const nextLocation = getNextLocation(current, payload);
  if (!hasBusinessLocationChanged(current, nextLocation)) return "";
  if (hasNoLocation(nextLocation)) return "";
  if (hasPartialLocation(nextLocation)) {
    return "Konumu güncellemek için il, ilçe ve Mahalle / Köy alanlarını birlikte seçin.";
  }
  let isValidLocation = false;
  try {
    isValidLocation = await isValidStandardBusinessLocation(nextLocation);
  } catch {
    isValidLocation = false;
  }
  if (!isValidLocation) {
    return "Lütfen geçerli il, ilçe ve Mahalle / Köy seçin.";
  }
  return "";
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
    throw new Error(safeSupabaseError("Isletme profili guncellenemedi"));
  }

  const business = Array.isArray(body) ? body[0] : body;
  if (!business?.id) {
    throw new Error("Isletme profili guncellenemedi");
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
    const locationError = await validateLocationUpdate(business, payload);
    if (locationError) {
      return jsonError(locationError, 400);
    }
    const updatedBusiness = await updateBusinessProfile(
      url,
      serviceRoleKey,
      businessId,
      payload,
    );

    return privateBusinessJson({ business: updatedBusiness });
  } catch (error) {
    if (error instanceof PublicRouteError) {
      return jsonError(error.publicMessage, error.status);
    }
    const status = error instanceof ServerConfigError ? 500 : 400;
    return jsonError("Profil güncellenemedi. Lütfen tekrar deneyin.", status);
  }
}
