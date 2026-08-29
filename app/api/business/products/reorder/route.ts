import {
  PRODUCT_REORDER_MAX_ITEMS,
  ProductRequestError,
  UUID_PATTERN,
  ensureProductWriteAllowed,
  fetchBusinessesForUser,
  getBearerToken,
  getSingleUserBusiness,
  getSupabaseServerConfig,
  getUserFromToken,
  isPlainObject,
  isValidProductMutationTimestamp,
  productError,
  productJson,
  reorderProductsAtomically,
  resolveProductRouteError,
} from "../_utils";

export type ReorderItem = {
  productId: string;
  sortOrder: number;
  expectedUpdatedAt: string;
};

export function parseReorderItems(body: Record<string, unknown>) {
  if (
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "items") ||
    !Array.isArray(body.items) ||
    body.items.length < 2 ||
    body.items.length > PRODUCT_REORDER_MAX_ITEMS
  ) {
    throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
  }

  const seenProductIds = new Set<string>();
  const seenSortOrders = new Set<number>();

  return body.items.map((item) => {
    if (
      !isPlainObject(item) ||
      Object.keys(item).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(item, "productId") ||
      !Object.prototype.hasOwnProperty.call(item, "sortOrder") ||
      !Object.prototype.hasOwnProperty.call(item, "expectedUpdatedAt") ||
      typeof item.productId !== "string" ||
      !UUID_PATTERN.test(item.productId) ||
      !Number.isInteger(item.sortOrder) ||
      Number(item.sortOrder) < 0 ||
      !isValidProductMutationTimestamp(item.expectedUpdatedAt)
    ) {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }

    if (
      seenProductIds.has(item.productId) ||
      seenSortOrders.has(item.sortOrder as number)
    ) {
      throw new ProductRequestError("INVALID_PRODUCT_MUTATION", 400);
    }
    seenProductIds.add(item.productId);
    seenSortOrders.add(item.sortOrder as number);

    return {
      productId: item.productId,
      sortOrder: item.sortOrder,
      expectedUpdatedAt: item.expectedUpdatedAt,
    } as ReorderItem;
  });
}

export async function POST(request: Request) {
  try {
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
    const items = parseReorderItems(body);

    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) return productError("PRODUCT_UNAUTHORIZED", 401);

    const business = getSingleUserBusiness(
      await fetchBusinessesForUser(url, serviceRoleKey, user.id),
    );
    ensureProductWriteAllowed(business);

    const products = await reorderProductsAtomically(
      url,
      serviceRoleKey,
      business.id,
      items,
    );
    return productJson({ products });
  } catch (error) {
    const safeError = resolveProductRouteError(error);
    return productError(safeError.code, safeError.status);
  }
}
