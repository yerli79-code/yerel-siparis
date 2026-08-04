import type { Product } from "./businesses";

export const PUBLIC_CART_TTL_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_CART_MAX_QUANTITY = 99;

const publicCartStorageKeyPrefix = "yerel-siparis:cart:v1:";

export type StoredPublicCartV1 = {
  version: 1;
  businessSlug: string;
  updatedAt: number;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
};

export type RestoredPublicCartItem = Product & { quantity: number };

type PublicCartStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidStoredItem(
  value: unknown,
): value is StoredPublicCartV1["items"][number] {
  if (!isRecord(value)) return false;

  return (
    typeof value.productId === "string" &&
    Boolean(value.productId.trim()) &&
    Number.isSafeInteger(value.quantity) &&
    (value.quantity as number) > 0
  );
}

function safelyRemoveStoredCart(storage: PublicCartStorage, businessSlug: string) {
  try {
    storage.removeItem(getPublicCartStorageKey(businessSlug));
  } catch {
    // Storage can be unavailable or blocked. Cart state must still keep working.
  }
}

function isCompatibleStoredCart(
  value: unknown,
  businessSlug: string,
  now: number,
): value is StoredPublicCartV1 {
  if (!isRecord(value)) return false;

  return (
    value.version === 1 &&
    value.businessSlug === businessSlug &&
    Number.isSafeInteger(value.updatedAt) &&
    (value.updatedAt as number) > 0 &&
    (value.updatedAt as number) <= now &&
    now - (value.updatedAt as number) < PUBLIC_CART_TTL_MS &&
    Array.isArray(value.items)
  );
}

export function getPublicCartStorageKey(businessSlug: string) {
  return `${publicCartStorageKeyPrefix}${encodeURIComponent(businessSlug)}`;
}

export function readPublicCart(
  storage: PublicCartStorage,
  businessSlug: string,
  catalogProducts: readonly Product[],
  now = Date.now(),
): RestoredPublicCartItem[] {
  let rawValue: string | null;

  try {
    rawValue = storage.getItem(getPublicCartStorageKey(businessSlug));
  } catch {
    return [];
  }

  if (!rawValue) return [];

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue) as unknown;
  } catch {
    safelyRemoveStoredCart(storage, businessSlug);
    return [];
  }

  if (!isCompatibleStoredCart(parsedValue, businessSlug, now)) {
    safelyRemoveStoredCart(storage, businessSlug);
    return [];
  }

  const activeProductsById = new Map(
    catalogProducts
      .filter((product) => product.isActive !== false)
      .map((product) => [product.id, product] as const),
  );
  const restoredItems: RestoredPublicCartItem[] = [];
  const restoredItemsById = new Map<string, RestoredPublicCartItem>();

  parsedValue.items.forEach((storedItem) => {
    if (!isValidStoredItem(storedItem)) return;

    const productId = storedItem.productId.trim();
    const currentProduct = activeProductsById.get(productId);
    if (!currentProduct) return;

    const existingItem = restoredItemsById.get(productId);
    if (existingItem) {
      existingItem.quantity = Math.min(
        existingItem.quantity + storedItem.quantity,
        PUBLIC_CART_MAX_QUANTITY,
      );
      return;
    }

    const restoredItem = {
      ...currentProduct,
      quantity: Math.min(storedItem.quantity, PUBLIC_CART_MAX_QUANTITY),
    };
    restoredItemsById.set(productId, restoredItem);
    restoredItems.push(restoredItem);
  });

  if (restoredItems.length === 0) {
    safelyRemoveStoredCart(storage, businessSlug);
  }

  return restoredItems;
}

export function persistPublicCart(
  storage: PublicCartStorage,
  businessSlug: string,
  cart: readonly RestoredPublicCartItem[],
  now = Date.now(),
) {
  if (cart.length === 0) {
    safelyRemoveStoredCart(storage, businessSlug);
    return;
  }

  const items = cart.flatMap((item) => {
    const productId = item.id.trim();
    if (!productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      return [];
    }

    return [
      {
        productId,
        quantity: Math.min(item.quantity, PUBLIC_CART_MAX_QUANTITY),
      },
    ];
  });

  if (items.length === 0) {
    safelyRemoveStoredCart(storage, businessSlug);
    return;
  }

  const storedCart: StoredPublicCartV1 = {
    version: 1,
    businessSlug,
    updatedAt: now,
    items,
  };

  try {
    storage.setItem(
      getPublicCartStorageKey(businessSlug),
      JSON.stringify(storedCart),
    );
  } catch {
    // Ignore quota and security errors. The in-memory cart remains authoritative.
  }
}

export function clearPublicCart(
  storage: PublicCartStorage,
  businessSlug: string,
) {
  safelyRemoveStoredCart(storage, businessSlug);
}
