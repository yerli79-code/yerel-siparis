import { businesses, type Business } from "./businesses";

export const BUSINESS_STORAGE_KEY = "yerel-siparis-businesses-v1";
export const ACTIVE_BUSINESS_KEY = "yerel-siparis-active-business";

function cloneSeedBusinesses() {
  return businesses.map((business) => ({
    ...business,
    productCategories: business.productCategories.map((category) => ({
      ...category,
      products: category.products.map((product) => ({ ...product })),
    })),
  }));
}

export function readBusinessesFromStorage() {
  if (typeof window === "undefined") {
    return cloneSeedBusinesses();
  }

  const storedValue = window.localStorage.getItem(BUSINESS_STORAGE_KEY);

  if (!storedValue) {
    const seed = cloneSeedBusinesses();
    window.localStorage.setItem(BUSINESS_STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  try {
    const parsedValue = JSON.parse(storedValue) as Business[];
    return Array.isArray(parsedValue) ? parsedValue : cloneSeedBusinesses();
  } catch {
    const seed = cloneSeedBusinesses();
    window.localStorage.setItem(BUSINESS_STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

export function writeBusinessesToStorage(nextBusinesses: Business[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    BUSINESS_STORAGE_KEY,
    JSON.stringify(nextBusinesses),
  );
}

export function mergeBusinessIntoStorage(nextBusiness: Business) {
  const businesses = readBusinessesFromStorage();
  const hasBusiness = businesses.some(
    (business) => business.slug === nextBusiness.slug,
  );
  const nextBusinesses = hasBusiness
    ? businesses.map((business) =>
        business.slug === nextBusiness.slug ? nextBusiness : business,
      )
    : [nextBusiness, ...businesses];

  writeBusinessesToStorage(nextBusinesses);
  return nextBusinesses;
}

export function getActiveBusinessSlug() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(ACTIVE_BUSINESS_KEY) ?? "";
}

export function setActiveBusinessSlug(slug: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ACTIVE_BUSINESS_KEY, slug);
}

export function clearActiveBusinessSlug() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACTIVE_BUSINESS_KEY);
}

export function createSlug(value: string) {
  const slug = value
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || `kayit-${Date.now()}`;
}
