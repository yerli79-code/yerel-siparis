import {
  buildProductPayload,
  createClientProductId,
  ensureProductWriteAllowed,
  fetchBusinessesForUser,
  fetchProductsForBusiness,
  getBearerToken,
  getCreateProductInput,
  getNextSortOrder,
  getSingleUserBusiness,
  getSupabaseServerConfig,
  getUserFromToken,
  insertProduct,
  isPlainObject,
  productError,
  productJson,
  resolveProductRouteError,
} from "./_utils";

export async function GET(request: Request) {
  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return productError("PRODUCT_UNAUTHORIZED", 401);
    }

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return productError("PRODUCT_UNAUTHORIZED", 401);
    }

    const business = getSingleUserBusiness(
      await fetchBusinessesForUser(url, serviceRoleKey, user.id),
    );
    const products = await fetchProductsForBusiness(
      url,
      serviceRoleKey,
      business.id,
    );

    return productJson({ products });
  } catch (error) {
    const safeError = resolveProductRouteError(error);
    return productError(safeError.code, safeError.status);
  }
}

export async function POST(request: Request) {
  try {
    const { url, anonKey, serviceRoleKey } = getSupabaseServerConfig();
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return productError("PRODUCT_UNAUTHORIZED", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }

    if (!isPlainObject(body)) {
      return productError("INVALID_PRODUCT_MUTATION", 400);
    }

    const input = getCreateProductInput(body);
    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return productError("PRODUCT_UNAUTHORIZED", 401);
    }

    const business = getSingleUserBusiness(
      await fetchBusinessesForUser(url, serviceRoleKey, user.id),
    );
    ensureProductWriteAllowed(business);

    const payload = buildProductPayload(input, {
      requireName: true,
      requirePrice: true,
      requireCategory: true,
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

    return productJson({ product });
  } catch (error) {
    const safeError = resolveProductRouteError(error);
    return productError(safeError.code, safeError.status);
  }
}
