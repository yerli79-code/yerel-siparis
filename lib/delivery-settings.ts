export const LEGACY_DELIVERY_STATUS_SENTINEL = "Teslimat bilgisi eklenmedi";

export function isLegacyDeliveryStatusSentinel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;

  return (
    trimmed.localeCompare(LEGACY_DELIVERY_STATUS_SENTINEL, "tr", {
      sensitivity: "accent",
    }) === 0 ||
    trimmed.toLocaleLowerCase("tr-TR") ===
      LEGACY_DELIVERY_STATUS_SENTINEL.toLocaleLowerCase("tr-TR")
  );
}

export function normalizeDeliveryStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isLegacyDeliveryStatusSentinel(trimmed)) return null;
  return trimmed;
}

export function getDisplayDeliveryStatus(value: unknown): string {
  return normalizeDeliveryStatus(value) ?? "";
}
