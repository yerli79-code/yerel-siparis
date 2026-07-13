import { type Business, getSeedBusinesses } from "./businesses";
import { getPaymentMethodModeOrDefault } from "./payment-methods";

const key = "yerel-siparis-businesses-v2";

function withPaymentMethodDefault(business: Business): Business {
  return {
    ...business,
    paymentMethodMode: getPaymentMethodModeOrDefault(business.paymentMethodMode),
  };
}

export function readBusinesses() {
  if (typeof window === "undefined") return getSeedBusinesses();

  const stored = window.localStorage.getItem(key);
  if (!stored) {
    const seed = getSeedBusinesses();
    window.localStorage.setItem(key, JSON.stringify(seed));
    return seed;
  }

  try {
    const parsed = JSON.parse(stored) as Business[];
    return Array.isArray(parsed)
      ? parsed.map(withPaymentMethodDefault)
      : getSeedBusinesses();
  } catch {
    return getSeedBusinesses();
  }
}

export function writeBusinesses(businesses: Business[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(businesses));
}

export function updateBusiness(nextBusiness: Business) {
  const businesses = readBusinesses();
  const nextBusinesses = businesses.map((business) =>
    business.slug === nextBusiness.slug ? nextBusiness : business,
  );
  writeBusinesses(nextBusinesses);
  return nextBusinesses;
}
