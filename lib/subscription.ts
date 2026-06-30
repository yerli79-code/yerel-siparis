import type { Business } from "./businesses";

const dayMs = 24 * 60 * 60 * 1000;

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
