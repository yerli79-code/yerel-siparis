import { NextResponse } from "next/server";

type BusinessRow = {
  owner_id?: string | null;
  email?: string | null;
};

type ProfileRow = {
  id?: string | null;
  email?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
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

async function fetchBusinesses(url: string, serviceRoleKey: string) {
  const response = await fetch(
    `${url}/rest/v1/businesses?select=*&order=created_at.desc`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    return {
      ok: false,
      body,
    };
  }

  return {
    ok: true,
    body: Array.isArray(body) ? body : [],
  };
}

async function fetchProfileEmails(
  url: string,
  serviceRoleKey: string,
  ownerIds: string[],
) {
  if (ownerIds.length === 0) return new Map<string, string>();

  const response = await fetch(
    `${url}/rest/v1/profiles?id=in.(${ownerIds
      .map((id) => encodeURIComponent(id))
      .join(",")})&select=id,email`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok || !Array.isArray(body)) {
    return new Map<string, string>();
  }

  return new Map(
    (body as ProfileRow[])
      .filter((profile) => profile.id && profile.email)
      .map((profile) => [profile.id as string, profile.email as string]),
  );
}

async function attachOwnerEmails(
  url: string,
  serviceRoleKey: string,
  businesses: BusinessRow[],
) {
  const ownerIds = Array.from(
    new Set(
      businesses
        .map((business) => business.owner_id)
        .filter(
          (ownerId): ownerId is string =>
            typeof ownerId === "string" && UUID_PATTERN.test(ownerId),
        ),
    ),
  );
  const profileEmails = await fetchProfileEmails(url, serviceRoleKey, ownerIds);

  return businesses.map((business) => ({
    ...business,
    email: business.owner_id ? profileEmails.get(business.owner_id) ?? "" : "",
  }));
}

export async function GET(request: Request) {
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

    const result = await fetchBusinesses(url, serviceRoleKey);
    if (!result.ok) {
      return jsonError("Isletme listesi alinamadi.", 400);
    }

    const businesses = await attachOwnerEmails(
      url,
      serviceRoleKey,
      result.body as BusinessRow[],
    );

    return NextResponse.json({ businesses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError("İşletme listesi alınamadı. Lütfen tekrar deneyin.", status);
  }
}
