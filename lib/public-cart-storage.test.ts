import assert from "node:assert/strict";
import { test } from "node:test";
import type { Product } from "./businesses";
import {
  PUBLIC_CART_MAX_QUANTITY,
  PUBLIC_CART_TTL_MS,
  clearPublicCart,
  getPublicCartStorageKey,
  persistPublicCart,
  readPublicCart,
  type StoredPublicCartV1,
} from "./public-cart-storage";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const now = 1_800_000_000_000;

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "Guncel urun",
    price: 125,
    description: "Guncel aciklama",
    imageLabel: "Guncel",
    isActive: true,
    ...overrides,
  };
}

function storePayload(
  storage: MemoryStorage,
  businessSlug: string,
  overrides: Partial<StoredPublicCartV1> = {},
) {
  const payload: StoredPublicCartV1 = {
    version: 1,
    businessSlug,
    updatedAt: now,
    items: [{ productId: "product-1", quantity: 2 }],
    ...overrides,
  };

  storage.setItem(getPublicCartStorageKey(businessSlug), JSON.stringify(payload));
}

test("storage key encodes the business slug as one safe key segment", () => {
  assert.equal(
    getPublicCartStorageKey("dukkan/../sube?#"),
    "yerel-siparis:cart:v1:dukkan%2F..%2Fsube%3F%23",
  );
});

test("persist stores only product ids and bounded quantities per business", () => {
  const storage = new MemoryStorage();
  const firstSlug = "birinci-isletme";
  const secondSlug = "ikinci-isletme";
  const secondKey = getPublicCartStorageKey(secondSlug);
  storage.setItem(secondKey, "second-cart");

  persistPublicCart(
    storage,
    firstSlug,
    [
      {
        ...product({ name: "Storage'a yazilmamali", price: 999 }),
        quantity: 150,
      },
    ],
    now,
  );

  const rawValue = storage.getItem(getPublicCartStorageKey(firstSlug));
  assert.ok(rawValue);
  assert.deepEqual(JSON.parse(rawValue), {
    version: 1,
    businessSlug: firstSlug,
    updatedAt: now,
    items: [
      {
        productId: "product-1",
        quantity: PUBLIC_CART_MAX_QUANTITY,
      },
    ],
  });
  assert.equal(rawValue.includes("Storage'a yazilmamali"), false);
  assert.equal(rawValue.includes("999"), false);
  assert.equal(storage.getItem(secondKey), "second-cart");
});

test("restore reconciles ids with current catalog names and prices", () => {
  const storage = new MemoryStorage();
  const slug = "guncel-katalog";
  storePayload(storage, slug);

  assert.deepEqual(readPublicCart(storage, slug, [product()], now), [
    { ...product(), quantity: 2 },
  ]);
});

test("restore drops missing, inactive and invalid items and caps duplicate quantities", () => {
  const storage = new MemoryStorage();
  const slug = "filtreli-katalog";
  storePayload(storage, slug, {
    items: [
      { productId: "product-1", quantity: 70 },
      { productId: "product-1", quantity: 70 },
      { productId: "inactive", quantity: 2 },
      { productId: "missing", quantity: 2 },
      { productId: "fractional", quantity: 1.5 },
      { productId: "zero", quantity: 0 },
    ],
  });

  const restored = readPublicCart(
    storage,
    slug,
    [
      product(),
      product({ id: "inactive", isActive: false }),
      product({ id: "fractional" }),
      product({ id: "zero" }),
    ],
    now,
  );

  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "product-1");
  assert.equal(restored[0].quantity, PUBLIC_CART_MAX_QUANTITY);
});

test("a cart remains valid until the explicit 24-hour TTL expires", () => {
  const storage = new MemoryStorage();
  const slug = "ttl-isletmesi";
  const otherCartKey = getPublicCartStorageKey("diger-isletme");
  storePayload(storage, slug);
  storage.setItem(otherCartKey, "other-cart");

  assert.equal(PUBLIC_CART_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(
    readPublicCart(storage, slug, [product()], now + PUBLIC_CART_TTL_MS - 1)
      .length,
    1,
  );
  assert.equal(
    readPublicCart(storage, slug, [product()], now + PUBLIC_CART_TTL_MS).length,
    0,
  );
  assert.equal(storage.getItem(getPublicCartStorageKey(slug)), null);
  assert.equal(storage.getItem(otherCartKey), "other-cart");
});

test("restore keeps updatedAt while a real cart change refreshes it", () => {
  const storage = new MemoryStorage();
  const slug = "updated-at-isletmesi";
  const key = getPublicCartStorageKey(slug);
  storePayload(storage, slug);

  const originalRawValue = storage.getItem(key);
  const restoredCart = readPublicCart(storage, slug, [product()], now + 1_000);
  assert.equal(storage.getItem(key), originalRawValue);

  persistPublicCart(
    storage,
    slug,
    [{ ...restoredCart[0], quantity: restoredCart[0].quantity + 1 }],
    now + 2_000,
  );
  const updatedPayload = JSON.parse(storage.getItem(key) ?? "null") as
    | StoredPublicCartV1
    | null;
  assert.equal(updatedPayload?.updatedAt, now + 2_000);
  assert.equal(updatedPayload?.items[0]?.quantity, 3);
});

for (const [label, rawValue] of [
  ["invalid JSON", "{"],
  [
    "wrong version",
    JSON.stringify({
      version: 2,
      businessSlug: "bozuk-isletme",
      updatedAt: now,
      items: [],
    }),
  ],
  [
    "wrong slug",
    JSON.stringify({
      version: 1,
      businessSlug: "baska-isletme",
      updatedAt: now,
      items: [],
    }),
  ],
  [
    "future timestamp",
    JSON.stringify({
      version: 1,
      businessSlug: "bozuk-isletme",
      updatedAt: now + 1,
      items: [],
    }),
  ],
] as const) {
  test(`restore safely removes ${label}`, () => {
    const storage = new MemoryStorage();
    const slug = "bozuk-isletme";
    const key = getPublicCartStorageKey(slug);
    storage.setItem(key, rawValue);

    assert.deepEqual(readPublicCart(storage, slug, [product()], now), []);
    assert.equal(storage.getItem(key), null);
  });
}

test("empty and explicit clears remove only the selected business cart", () => {
  const storage = new MemoryStorage();
  const firstSlug = "birinci-isletme";
  const secondSlug = "ikinci-isletme";
  const customerDetailsKey = "yerel-siparis:customer-details:v1";
  storePayload(storage, firstSlug);
  storePayload(storage, secondSlug);
  storage.setItem(customerDetailsKey, "remembered-customer");

  persistPublicCart(storage, firstSlug, [], now);
  assert.equal(storage.getItem(getPublicCartStorageKey(firstSlug)), null);
  assert.ok(storage.getItem(getPublicCartStorageKey(secondSlug)));

  clearPublicCart(storage, secondSlug);
  assert.equal(storage.getItem(getPublicCartStorageKey(secondSlug)), null);
  assert.equal(storage.getItem(customerDetailsKey), "remembered-customer");
});

test("quota and security errors never escape storage helpers", () => {
  const unavailableStorage = {
    getItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    removeItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem() {
      throw new DOMException("full", "QuotaExceededError");
    },
  };

  assert.doesNotThrow(() =>
    persistPublicCart(
      unavailableStorage,
      "storage-error",
      [{ ...product(), quantity: 1 }],
      now,
    ),
  );
  assert.doesNotThrow(() => clearPublicCart(unavailableStorage, "storage-error"));
  assert.deepEqual(
    readPublicCart(unavailableStorage, "storage-error", [product()], now),
    [],
  );
});
