import { NextResponse } from "next/server";
import {
  UUID_PATTERN,
  buildProductPayload,
  deleteProductById,
  ensureProductWriteAllowed,
  fetchBusinessById,
  fetchProductById,
  getBearerToken,
  getProductInput,
  getSupabaseServerConfig,
  getUserFromToken,
  isPlainObject,
  jsonError,
  updateProductById,
} from "../_utils";

type RouteContext = {
  params: Promise<{ productId: string }>;
};

async function getProductAccess(
  url: string,
  serviceRoleKey: string,
  productId: string,
  userId: string,
) {
  const product = await fetchProductById(url, serviceRoleKey, productId);
  if (!product) {
    return { product: null, business: null };
  }

  const business = await fetchBusinessById(
    url,
    serviceRoleKey,
    product.business_id,
  );
  if (!business || business.owner_id !== userId) {
    return { product: null, business: null };
  }

  return { product, business };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { productId } = await context.params;
    if (!UUID_PATTERN.test(productId)) {
      return jsonError("Gecersiz productId.", 400);
    }

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

    const { product, business } = await getProductAccess(
      url,
      serviceRoleKey,
      productId,
      user.id,
    );
    if (!product || !business) {
      return jsonError("Urun bulunamadi.", 404);
    }

    ensureProductWriteAllowed(business);
    const payload = buildProductPayload(input);
    const updatedProduct = await updateProductById(
      url,
      serviceRoleKey,
      product.id,
      payload,
    );

    return NextResponse.json({ product: updatedProduct });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Urun guncellenemedi.";
    const status =
      error instanceof Error && error.name === "Forbidden"
        ? 403
        : message.includes("SUPABASE_SERVICE_ROLE_KEY")
        ? 500
        : 400;
    return jsonError(message, status);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { productId } = await context.params;
    if (!UUID_PATTERN.test(productId)) {
      return jsonError("Gecersiz productId.", 400);
    }

    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return jsonError("Oturum bulunamadi.", 401);
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return jsonError("Gecersiz veya suresi dolmus oturum.", 401);
    }

    const { product, business } = await getProductAccess(
      url,
      serviceRoleKey,
      productId,
      user.id,
    );
    if (!product || !business) {
      return jsonError("Urun bulunamadi.", 404);
    }

    ensureProductWriteAllowed(business);
    await deleteProductById(url, serviceRoleKey, product.id);

    return NextResponse.json({ deleted: true, productId: product.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Urun silinemedi.";
    const status =
      error instanceof Error && error.name === "Forbidden"
        ? 403
        : message.includes("SUPABASE_SERVICE_ROLE_KEY")
        ? 500
        : 400;
    return jsonError(message, status);
  }
}
