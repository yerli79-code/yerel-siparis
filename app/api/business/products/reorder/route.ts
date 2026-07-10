import { NextResponse } from "next/server";
import {
  ProductRequestError,
  UUID_PATTERN,
  bulkUpdateProductSortOrders,
  ensureProductWriteAllowed,
  fetchBusinessesForUser,
  getBearerToken,
  getSupabaseServerConfig,
  getUserFromToken,
  isPlainObject,
  jsonError,
  resolveProductRouteError,
  type SupabaseProductRow,
} from "../_utils";

type ReorderItem = {
  productId: string;
  sortOrder: number;
};

const productSelect =
  "id,business_id,client_product_id,name,price,description,category,image_label,image_url,is_active,sort_order,created_at,updated_at";

async function fetchOwnedProductsByIds(
  url: string,
  serviceRoleKey: string,
  businessId: string,
  productIds: string[],
) {
  const response = await fetch(
    `${url}/rest/v1/products?business_id=eq.${encodeURIComponent(
      businessId,
    )}&id=in.(${productIds.join(",")})&select=${productSelect}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Urun bilgileri alinamadi.");
  }

  if (!response.ok) {
    throw new Error("Urun bilgileri alinamadi.");
  }

  return Array.isArray(body) ? (body as SupabaseProductRow[]) : [];
}

function parseReorderItems(body: Record<string, unknown>) {
  const rootKeys = Object.keys(body);
  const extraRootKeys = rootKeys.filter((key) => key !== "items");
  if (extraRootKeys.length > 0) {
    throw new ProductRequestError(
      `Bu alanlar urun siralama isleminde kullanilamaz: ${extraRootKeys.join(", ")}`,
    );
  }
  if (!Array.isArray(body.items) || body.items.length < 2) {
    throw new ProductRequestError(
      "Siralama icin en az iki urun bilgisi gerekir.",
    );
  }

  const seenProductIds = new Set<string>();
  const seenSortOrders = new Set<number>();

  return body.items.map((item) => {
    if (!isPlainObject(item)) {
      throw new ProductRequestError("Siralama bilgisi gecersiz.");
    }
    const itemKeys = Object.keys(item);
    const extraItemKeys = itemKeys.filter(
      (key) => key !== "productId" && key !== "sortOrder",
    );
    if (extraItemKeys.length > 0) {
      throw new ProductRequestError(
        `Bu alanlar urun siralama isleminde kullanilamaz: ${extraItemKeys.join(", ")}`,
      );
    }
    if (typeof item.productId !== "string" || !UUID_PATTERN.test(item.productId)) {
      throw new ProductRequestError("Gecersiz productId.");
    }
    if (seenProductIds.has(item.productId)) {
      throw new ProductRequestError(
        "Ayni urun birden fazla kez siralanamaz.",
      );
    }
    seenProductIds.add(item.productId);

    const sortOrder = Number(item.sortOrder);
    if (!Number.isFinite(sortOrder) || !Number.isInteger(sortOrder)) {
      throw new ProductRequestError("sortOrder gecerli bir sayi olmalidir.");
    }
    if (seenSortOrders.has(sortOrder)) {
      throw new ProductRequestError(
        "Ayni sira degeri birden fazla urune verilemez.",
      );
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

    const businesses = await fetchBusinessesForUser(
      url,
      serviceRoleKey,
      user.id,
    );
    if (businesses.length !== 1) {
      return jsonError("Bir veya daha fazla ürün bulunamadı.", 404);
    }

    const business = businesses[0];
    ensureProductWriteAllowed(business);

    const products = await fetchOwnedProductsByIds(
      url,
      serviceRoleKey,
      business.id,
      items.map((item) => item.productId),
    );
    if (products.length !== items.length) {
      return jsonError("Bir veya daha fazla ürün bulunamadı.", 404);
    }

    const sortOrderByProductId = new Map(
      items.map((item) => [item.productId, item.sortOrder]),
    );
    const updatedProducts = await bulkUpdateProductSortOrders(
      url,
      serviceRoleKey,
      products.map((product) => ({
        id: product.id,
        business_id: business.id,
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
    const safeError = resolveProductRouteError(
      error,
      "Ürün sıralaması güncellenemedi. Lütfen tekrar deneyin.",
    );
    return jsonError(safeError.message, safeError.status);
  }
}
