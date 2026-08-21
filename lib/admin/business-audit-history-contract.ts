export const ADMIN_BUSINESS_AUDIT_HISTORY_LIMIT = 20;

export const ADMIN_BUSINESS_AUDIT_HISTORY_SELECT = [
  "id",
  "action",
  "actor_email",
  "created_at",
  "before_state",
  "after_state",
].join(",");

export type AdminBusinessAuditSnapshot = {
  isActive: boolean;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
};

export type AdminBusinessAuditItem = {
  id: string;
  action: string;
  actorEmail: string;
  createdAt: string;
  before: AdminBusinessAuditSnapshot;
  after: AdminBusinessAuditSnapshot;
};

export type AdminBusinessAuditHistoryResponse = {
  items: AdminBusinessAuditItem[];
};

const ACTION_LABELS: Readonly<Record<string, string>> = {
  "business.deactivated": "Pasife alındı",
  "business.reactivated": "Aktife alındı",
  "legacy_subscription.recovered": "Eski abonelik aktifleştirildi",
  "business.blocked": "Engellendi",
  "subscription.reset": "Abonelik sıfırlandı",
  "subscription.extended": "Abonelik uzatıldı",
  "subscription.date_changed": "Abonelik tarihi değiştirildi",
};

const RESPONSE_KEYS = new Set(["items"]);
const ITEM_KEYS = new Set([
  "id",
  "action",
  "actorEmail",
  "createdAt",
  "before",
  "after",
]);
const SNAPSHOT_KEYS = new Set([
  "isActive",
  "subscriptionStatus",
  "subscriptionStartedAt",
  "subscriptionExpiresAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isSubscriptionStatus(
  value: unknown,
): value is AdminBusinessAuditSnapshot["subscriptionStatus"] {
  return value === "active" || value === "expired" || value === "blocked";
}

function parseSnapshot(value: unknown): AdminBusinessAuditSnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) return null;
  if (
    typeof value.isActive !== "boolean" ||
    !isSubscriptionStatus(value.subscriptionStatus) ||
    !isNullableTimestamp(value.subscriptionStartedAt) ||
    !isNullableTimestamp(value.subscriptionExpiresAt)
  ) {
    return null;
  }

  return {
    isActive: value.isActive,
    subscriptionStatus: value.subscriptionStatus,
    subscriptionStartedAt: value.subscriptionStartedAt,
    subscriptionExpiresAt: value.subscriptionExpiresAt,
  };
}

function parseItem(value: unknown): AdminBusinessAuditItem | null {
  if (!isRecord(value) || !hasExactKeys(value, ITEM_KEYS)) return null;
  const before = parseSnapshot(value.before);
  const after = parseSnapshot(value.after);
  if (
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.action !== "string" ||
    !value.action ||
    typeof value.actorEmail !== "string" ||
    !value.actorEmail ||
    !isTimestamp(value.createdAt) ||
    !before ||
    !after
  ) {
    return null;
  }

  return {
    id: value.id,
    action: value.action,
    actorEmail: value.actorEmail,
    createdAt: value.createdAt,
    before,
    after,
  };
}

export function parseAdminBusinessAuditHistoryResponse(
  value: unknown,
): AdminBusinessAuditHistoryResponse | null {
  if (!isRecord(value) || !hasExactKeys(value, RESPONSE_KEYS) || !Array.isArray(value.items)) {
    return null;
  }

  const items = value.items.map(parseItem);
  if (items.some((item) => item === null)) return null;
  return { items: items as AdminBusinessAuditItem[] };
}

export function getAdminAuditActionLabel(action: string) {
  return ACTION_LABELS[action] ?? "Diğer kritik işlem";
}
