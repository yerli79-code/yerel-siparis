import { NextResponse } from "next/server";
import {
  UUID_PATTERN,
  bulkUpdateProductSortOrders,
  ensureProductWriteAllowed,
  fetchBusinessById,
  fetchProductsByIds,
  getBearerToken,
  getSupabaseServerConfig,
  getUserFromToken,
  isPlainObject,
  jsonError,
} from "../_utils";

type ReorderItem = {
  productId: string;
  sortOrder: number;
};

function parseReorderItems(body: Record<string, unknown>) {
  const rootKeys = Object.keys(body);
  const extraRootKeys = rootKeys.filter((key) => key !== "items");
  if (extraRootKeys.length > 0) {
    throw new Error(
      `Bu alanlar urun siralama isleminde kullanilamaz: ${extraRootKeys.join(", ")}`,
    );
  }
  if (!Array.isArray(body.items) || body.items.length < 2) {
    throw new Error("Siralama icin en az iki urun bilgisi gerekir.");
  }

  const seenProductIds = new Set<string>();
  const seenSortOrders = new Set<number>();

  return body.items.map((item) => {
    if (!isPlainObject(item)) {
      throw new Error("Siralama bilgisi gecersiz.");
    }
    const itemKeys = Object.keys(item);
    const extraItemKeys = itemKeys.filter(
      (key) => key !== "productId" && key !== "sortOrder",
    );
    if (extraItemKeys.length > 0) {
      throw new Error(
        `Bu alanlar urun siralama isleminde kullanilamaz: ${extraItemKeys.join(", ")}`,
      );
    }
    if (typeof item.productId !== "string" || !UUID_PATTERN.test(item.productId)) {
      throw new Error("Gecersiz productId.");
    }
    if (seenProductIds.has(item.productId)) {
      throw new Error("Ayni urun birden fazla kez siralanamaz.");
    }
    seenProductIds.add(item.productId);

    const sortOrder = Number(item.sortOrder);
    if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) {
      throw new Error("sortOrder gecerli bir sayi olmalidir.");
    }
    if (seenSortOrders.has(sortOrder)) {
      throw new Error("Ayni sira degeri birden fazla urune verilemez.");
    }
    seenSortOrders.add(sortOrder);

    return {
      productId: item.productId,
      sortOrder,
    };
  }) as ReorderItem[];
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

    const items = parseReorderItems(body);
    const user = await getUserFromToken(url, anonKey, accessToken);
    if (!user) {
      return jsonError("Gecersiz veya suresi dolmus oturum.", 401);
    }

    const products = await fetchProductsByIds(
      url,
      serviceRoleKey,
      items.map((item) => item.productId),
    );
    if (products.length !== items.length) {
      return jsonError("Urun bulunamadi.", 404);
    }

    const businessId = products[0]?.business_id;
    if (!businessId || products.some((product) => product?.business_id !== businessId)) {
      return jsonError("Tum urunler ayni isletmeye ait olmalidir.", 400);
    }

    const business = await fetchBusinessById(url, serviceRoleKey, businessId);
    if (!business || business.owner_id !== user.id) {
      return jsonError("Urun bulunamadi.", 404);
    }
    ensureProductWriteAllowed(business);

    const sortOrderByProductId = new Map(
      items.map((item) => [item.productId, item.sortOrder]),
    );
    const updatedProducts = await bulkUpdateProductSortOrders(
      url,
      serviceRoleKey,
      products.map((product) => ({
        id: product.id,
        business_id: product.business_id,
        client_product_id: product.client_product_id,
        name: product.name,
        price: product.price,
        description: product.description ?? "",
        category: product.category ?? "Genel",
        image_label: product.image_label ?? "",
        image_url: product.image_url,
        is_active: product.is_active ?? true,
        sort_order: sortOrderByProductId.get(product.id) ?? product.sort_order ?? 0,
      })),
    );
    const updatedIds = new Set(updatedProducts.map((product) => product.id));
    if (
      updatedProducts.length !== items.length ||
      items.some((item) => !updatedIds.has(item.productId))
    ) {
      throw new Error("Urun sirasi guncellenemedi. Lutfen tekrar deneyin.");
    }

    return NextResponse.json({ products: updatedProducts });
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "Urun sirasi guncellenemedi.";
    const message =
      rawMessage.includes("Urun sirasi guncellenemedi")
        ? "Urun sirasi guncellenemedi. Lutfen tekrar deneyin."
        : rawMessage;
    const status =
      error instanceof Error && error.name === "Forbidden"
        ? 403
        : message.includes("SUPABASE_SERVICE_ROLE_KEY")
        ? 500
        : 400;
    return jsonError(message, status);
  }
}
