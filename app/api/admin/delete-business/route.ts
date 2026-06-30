import { NextResponse } from "next/server";

type DeleteBusinessPayload = {
  businessId?: string;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
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

async function findBusinessById(
  url: string,
  serviceRoleKey: string,
  businessId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(businessId)}&select=id,slug&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error("İşletme kaydı sorgulanamadı.");
  }

  return Array.isArray(body) ? body[0] : null;
}

async function deleteProductsByBusinessId(
  url: string,
  serviceRoleKey: string,
  businessId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/products?business_id=eq.${encodeURIComponent(businessId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("İşletmeye ait ürünler silinemedi.");
  }
}

async function deleteBusinessById(
  url: string,
  serviceRoleKey: string,
  businessId: string,
) {
  const response = await fetch(
    `${url}/rest/v1/businesses?id=eq.${encodeURIComponent(businessId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("İşletme kaydı silinemedi.");
  }
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

    const payload = (await request.json()) as DeleteBusinessPayload;
    const businessId = payload.businessId?.trim();

    if (!businessId) {
      return jsonError("Silinecek işletme ID bilgisi eksik.");
    }

    const business = await findBusinessById(url, serviceRoleKey, businessId);
    if (!business?.id) {
      return NextResponse.json({
        deleted: false,
        notFound: true,
        message: "İşletme zaten silinmiş veya bulunamadı. Liste yenilendi.",
      });
    }

    await deleteProductsByBusinessId(url, serviceRoleKey, business.id);
    await deleteBusinessById(url, serviceRoleKey, business.id);

    return NextResponse.json({ deleted: true, businessId: business.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "İşletme silinemedi.";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError(message, status);
  }
}
