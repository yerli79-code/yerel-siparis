import { NextResponse } from "next/server";
import {
  buildProductPayload,
  createClientProductId,
  ensureProductWriteAllowed,
  fetchBusinessesForUser,
  fetchProductsForBusiness,
  getBearerToken,
  getNextSortOrder,
  getProductInput,
  getSingleUserBusiness,
  getSupabaseServerConfig,
  getUserFromToken,
  insertProduct,
  isPlainObject,
  jsonError,
} from "./_utils";

export async function GET(request: Request) {
  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return jsonError("Oturum bulunamadi.", 401);
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return jsonError("Gecersiz veya suresi dolmus oturum.", 401);
    }

    const business = getSingleUserBusiness(
      await fetchBusinessesForUser(url, serviceRoleKey, user.id),
    );
    const products = await fetchProductsForBusiness(
      url,
      serviceRoleKey,
      business.id,
    );

    return NextResponse.json({ products });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Urunler alinamadi.";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError(message, status);
  }
}

export async function POST(request: Request) {
  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return jsonError("Oturum bulunamadi.", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Gecersiz istek govdesi.", 400);
    }

    if (!isPlainObject(body)) {
      return jsonError("Gecersiz istek govdesi.", 400);
    }

    const input = getProductInput(body);
    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return jsonError("Gecersiz veya suresi dolmus oturum.", 401);
    }

    const business = getSingleUserBusiness(
      await fetchBusinessesForUser(url, serviceRoleKey, user.id),
    );
    ensureProductWriteAllowed(business);

    const payload = buildProductPayload(input, {
      requireName: true,
      requirePrice: true,
    });
    if (!("image_label" in payload) || payload.image_label === null) {
      payload.image_label = "";
    }
    if (!("sort_order" in payload)) {
      payload.sort_order = await getNextSortOrder(url, serviceRoleKey, business.id);
    }
    const imageLabel =
      typeof payload.image_label === "string" ? payload.image_label : "";

    const product = await insertProduct(url, serviceRoleKey, {
      ...payload,
      image_label: imageLabel,
      business_id: business.id,
      client_product_id: createClientProductId(),
    });

    return NextResponse.json({ product });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Urun olusturulamadi.";
    const status = message.includes("SUPABASE_SERVICE_ROLE_KEY") ? 500 : 400;
    return jsonError(message, status);
  }
}
