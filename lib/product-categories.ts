export const PRODUCT_CATEGORIES = [
  { key: "general", label: "Genel" },
  { key: "menus", label: "Menüler" },
  { key: "breakfast", label: "Kahvaltı" },
  { key: "soups", label: "Çorbalar" },
  { key: "salads", label: "Salatalar" },
  { key: "main-dishes", label: "Ana Yemekler" },
  { key: "doner", label: "Dönerler" },
  { key: "kebabs", label: "Kebaplar" },
  { key: "wraps", label: "Dürümler" },
  { key: "burgers", label: "Burgerler" },
  { key: "pizzas", label: "Pizzalar" },
  { key: "pide-lahmacun", label: "Pide ve Lahmacun" },
  { key: "toast-sandwiches", label: "Tost ve Sandviçler" },
  { key: "sides", label: "Yan Ürünler" },
  { key: "desserts", label: "Tatlılar" },
  { key: "drinks", label: "İçecekler" },
] as const;

export type StandardProductCategory =
  (typeof PRODUCT_CATEGORIES)[number]["label"];

const productCategoryLabels = new Set<string>(
  PRODUCT_CATEGORIES.map((category) => category.label),
);

export function getProductCategories() {
  return PRODUCT_CATEGORIES;
}

export function isStandardProductCategory(
  value: unknown,
): boolean {
  return (
    typeof value === "string" && productCategoryLabels.has(value.trim())
  );
}

export function normalizeProductCategory(
  value: unknown,
): StandardProductCategory | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  return isStandardProductCategory(normalized)
    ? (normalized as StandardProductCategory)
    : null;
}
