import type { Business } from "./businesses";

const dayMs = 24 * 60 * 60 * 1000;

export type AdminKpis = {
  total: number;
  active: number;
  inactive: number;
  createdLastSevenDays: number;
  activeSubscriptions: number;
  expiringSubscriptions: number;
};

export function getRemainingDays(expiresAt: string | null | undefined) {
  if (!expiresAt) return 0;
  const time = new Date(expiresAt).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.ceil((time - Date.now()) / dayMs);
}

export function addDaysFromToday(days: number) {
  return new Date(Date.now() + days * dayMs).toISOString();
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "Abonelik başlatılmadı";
  return new Date(value).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function getBadge(business: Business) {
  if (business.subscriptionStatus === "blocked") return "Engelli";
  if (!business.isActive) return "Pasif";
  const remaining = getRemainingDays(business.subscriptionExpiresAt);
  if (business.subscriptionStatus === "expired" || remaining <= 0) {
    return "Süresi Dolmuş";
  }
  if (remaining <= 15) return "Yaklaşıyor";
  return "Aktif";
}

export function getAccessMessage(business: Business) {
  if (business.subscriptionStatus === "blocked") {
    return "Bu işletme geçici olarak erişime kapatılmıştır.";
  }
  if (!business.isActive) return "Bu işletme şu anda aktif değildir.";
  if (
    business.subscriptionStatus === "expired" ||
    getRemainingDays(business.subscriptionExpiresAt) <= 0
  ) {
    return "Bu işletmenin abonelik süresi dolmuştur. Lütfen işletme ile iletişime geçiniz.";
  }
  return "";
}

export function canActivateBusiness(business: Business, now = Date.now()) {
  if (
    business.subscriptionStatus !== "active" ||
    !business.subscriptionExpiresAt
  ) {
    return false;
  }

  const expiresAt = new Date(business.subscriptionExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export function canReactivateBusinessAccess(
  business: Business,
  now = Date.now(),
) {
  if (
    business.isActive ||
    business.subscriptionStatus === "blocked" ||
    !business.subscriptionExpiresAt
  ) {
    return false;
  }

  const expiresAt = new Date(business.subscriptionExpiresAt).getTime();
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > now &&
    (business.subscriptionStatus === "active" ||
      business.subscriptionStatus === "expired")
  );
}

export function withReactivatedBusinessAccess(
  business: Business,
  now = Date.now(),
): Business | null {
  if (!canReactivateBusinessAccess(business, now)) return null;

  return {
    ...business,
    subscriptionStatus: "active",
    isActive: true,
  };
}

export function getAdminSubscriptionStatusLabel(
  business: Business,
  now = Date.now(),
) {
  if (
    business.subscriptionStatus === "expired" &&
    canReactivateBusinessAccess(business, now)
  ) {
    return "Düzeltme Gerekli";
  }

  return {
    active: "Aktif",
    expired: "Süresi Dolmuş",
    blocked: "Engelli",
  }[business.subscriptionStatus];
}

export function withBusinessAccess(
  business: Business,
  isActive: false,
  now?: number,
): Business;
export function withBusinessAccess(
  business: Business,
  isActive: true,
  now?: number,
): Business | null;
export function withBusinessAccess(
  business: Business,
  isActive: boolean,
  now = Date.now(),
) {
  if (isActive && !canActivateBusiness(business, now)) return null;
  return { ...business, isActive };
}

export function hasActiveSubscription(business: Business) {
  return business.isActive && canActivateBusiness(business);
}

export function isSubscriptionExpired(business: Business) {
  return (
    business.subscriptionStatus !== "blocked" &&
    (!business.subscriptionExpiresAt ||
      getRemainingDays(business.subscriptionExpiresAt) <= 0)
  );
}

export function isEndingWithinDays(business: Business, days: number) {
  if (!hasActiveSubscription(business)) return false;
  const remainingDays = getRemainingDays(business.subscriptionExpiresAt);
  return remainingDays > 0 && remainingDays <= days;
}

export function calculateAdminKpis(
  businesses: Business[],
  now = Date.now(),
): AdminKpis {
  const sevenDaysAgo = now - 7 * dayMs;

  return businesses.reduce<AdminKpis>(
    (totals, business) => {
      const createdAt = new Date(business.createdAt).getTime();

      totals.total += 1;
      totals.active += business.isActive ? 1 : 0;
      totals.inactive += business.isActive ? 0 : 1;
      totals.createdLastSevenDays +=
        Number.isFinite(createdAt) && createdAt >= sevenDaysAgo && createdAt <= now
          ? 1
          : 0;
      totals.activeSubscriptions += hasActiveSubscription(business) ? 1 : 0;
      totals.expiringSubscriptions += isEndingWithinDays(business, 30) ? 1 : 0;

      return totals;
    },
    {
      total: 0,
      active: 0,
      inactive: 0,
      createdLastSevenDays: 0,
      activeSubscriptions: 0,
      expiringSubscriptions: 0,
    },
  );
}
