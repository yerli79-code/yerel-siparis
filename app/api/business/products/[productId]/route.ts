import {
  UUID_PATTERN,
  buildProductPayload,
  deleteProductConditionally,
  ensureProductWriteAllowed,
  fetchBusinessById,
  fetchProductById,
  getBearerToken,
  getProductDeleteRequest,
  getProductMutationRequest,
  getSupabaseServerConfig,
  getUserFromToken,
  isPlainObject,
  isProductPayloadNoop,
  productError,
  productJson,
  resolveProductRouteError,
  updateProductConditionally,
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
  if (!product) return { product: null, business: null };

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
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }

    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);
    if (!accessToken) return productError("PRODUCT_UNAUTHORIZED", 401);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }
    if (!isPlainObject(body)) {
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }
    const { input, expectedUpdatedAt } = getProductMutationRequest(body);

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) return productError("PRODUCT_UNAUTHORIZED", 401);

    const { product, business } = await getProductAccess(
      url,
      serviceRoleKey,
      productId,
      user.id,
    );
    if (!product || !business) return productError("PRODUCT_NOT_FOUND", 404);

    ensureProductWriteAllowed(business);
    if (product.updated_at !== expectedUpdatedAt) {
      return productError("PRODUCT_CONFLICT", 409);
    }

    const payload = buildProductPayload(input);
    if (isProductPayloadNoop(product, payload)) {
      return productJson({ product });
    }

    const updatedProduct = await updateProductConditionally(
      url,
      serviceRoleKey,
      product.id,
      business.id,
      expectedUpdatedAt,
      payload,
    );
    if (!updatedProduct) return productError("PRODUCT_CONFLICT", 409);

    return productJson({ product: updatedProduct });
  } catch (error) {
    const safeError = resolveProductRouteError(error);
    return productError(safeError.code, safeError.status);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { productId } = await context.params;
    if (!UUID_PATTERN.test(productId)) {
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }

    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);
    if (!accessToken) return productError("PRODUCT_UNAUTHORIZED", 401);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }
    if (!isPlainObject(body)) {
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }
    const { expectedUpdatedAt } = getProductDeleteRequest(body);

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) return productError("PRODUCT_UNAUTHORIZED", 401);

    const { product, business } = await getProductAccess(
      url,
      serviceRoleKey,
      productId,
      user.id,
    );
    if (!product || !business) return productError("PRODUCT_NOT_FOUND", 404);

    ensureProductWriteAllowed(business);
    if (product.updated_at !== expectedUpdatedAt) {
      return productError("PRODUCT_CONFLICT", 409);
    }

    const deletedProduct = await deleteProductConditionally(
      url,
      serviceRoleKey,
      product.id,
      business.id,
      expectedUpdatedAt,
    );
    if (!deletedProduct) return productError("PRODUCT_CONFLICT", 409);

    return productJson({ product: deletedProduct });
  } catch (error) {
    const safeError = resolveProductRouteError(error);
    return productError(safeError.code, safeError.status);
  }
}
