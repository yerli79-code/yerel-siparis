export const ADMIN_BUSINESS_EXTENSION_DAYS = [30, 60, 90, 180, 365] as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SIMPLE_ACTION_KEYS = new Set(["expectedUpdatedAt"]);
const EXTEND_KEYS = new Set(["operation", "days", "expectedUpdatedAt"]);
const SET_DATE_KEYS = new Set(["operation", "expiresOn", "expectedUpdatedAt"]);
const RPC_SUCCESS_KEYS = new Set(["ok", "business", "auditAction"]);
const RPC_FAILURE_KEYS = new Set(["ok", "code"]);
const RPC_BUSINESS_KEYS = new Set([
  "id",
  "isActive",
  "subscriptionStatus",
  "subscriptionStartedAt",
  "subscriptionExpiresAt",
  "updatedAt",
]);
const RPC_FAILURE_CODES = new Set(["NOT_FOUND", "CONFLICT", "INVALID_STATE"]);
const RPC_AUDIT_ACTIONS = new Set([
  "business.deactivated",
  "business.reactivated",
  "legacy_subscription.recovered",
  "business.blocked",
  "subscription.reset",
  "subscription.extended",
  "subscription.date_changed",
]);
const RPC_AUDIT_ACTIONS_BY_ACTION: Record<AdminBusinessRpcAction, ReadonlySet<string>> = {
  deactivate: new Set(["business.deactivated"]),
  reactivate: new Set(["business.reactivated", "legacy_subscription.recovered"]),
  block: new Set(["business.blocked"]),
  reset_subscription: new Set(["subscription.reset"]),
  extend_subscription: new Set(["subscription.extended"]),
  set_subscription_date: new Set(["subscription.date_changed"]),
};

export type AdminBusinessExtensionDays =
  (typeof ADMIN_BUSINESS_EXTENSION_DAYS)[number];

export type AdminBusinessSimpleActionRequest = {
  expectedUpdatedAt: string;
};

export type AdminBusinessSubscriptionRequest =
  | {
      operation: "extend";
      days: AdminBusinessExtensionDays;
      expectedUpdatedAt: string;
    }
  | {
      operation: "setDate";
      expiresOn: string;
      expectedUpdatedAt: string;
    };

export type AdminBusinessRpcAction =
  | "deactivate"
  | "reactivate"
  | "block"
  | "reset_subscription"
  | "extend_subscription"
  | "set_subscription_date";

export type AdminBusinessActionRpcBody = {
  p_business_id: string;
  p_action: AdminBusinessRpcAction;
  p_expected_updated_at: string;
  p_actor_user_id: string;
  p_actor_email: string;
  p_extension_days: AdminBusinessExtensionDays | null;
  p_expires_on: string | null;
};

export type AdminBusinessCriticalDto = {
  id: string;
  isActive: boolean;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  updatedAt: string;
};

export type AdminBusinessActionSuccess = {
  ok: true;
  business: AdminBusinessCriticalDto;
  auditAction: string;
};

export type AdminBusinessActionFailure = {
  ok: false;
  code: "NOT_FOUND" | "CONFLICT" | "INVALID_STATE";
};

export type AdminBusinessActionRpcResult =
  | AdminBusinessActionSuccess
  | AdminBusinessActionFailure;

export class AdminBusinessActionContractError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, allowed: Set<string>) {
  const keys = Object.keys(record);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function parseExpectedUpdatedAt(value: unknown) {
  if (typeof value !== "string") {
    throw new AdminBusinessActionContractError("Güncelleme sürümü zorunludur.");
  }
  const timestamp = value.trim();
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    throw new AdminBusinessActionContractError("Güncelleme sürümü geçersizdir.");
  }
  return timestamp;
}

export function isCanonicalBusinessUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function parseAdminBusinessSimpleActionRequest(
  value: unknown,
): AdminBusinessSimpleActionRequest {
  if (!isRecord(value) || !hasExactKeys(value, SIMPLE_ACTION_KEYS)) {
    throw new AdminBusinessActionContractError(
      "Yalnızca güncelleme sürümü gönderilebilir.",
    );
  }
  return { expectedUpdatedAt: parseExpectedUpdatedAt(value.expectedUpdatedAt) };
}

export function isValidCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseAdminBusinessSubscriptionRequest(
  value: unknown,
): AdminBusinessSubscriptionRequest {
  if (!isRecord(value)) {
    throw new AdminBusinessActionContractError("Geçersiz istek gövdesi.");
  }

  if (value.operation === "extend") {
    if (!hasExactKeys(value, EXTEND_KEYS)) {
      throw new AdminBusinessActionContractError(
        "Uzatma işlemi yalnızca gün sayısı ve güncelleme sürümü kabul eder.",
      );
    }
    if (
      typeof value.days !== "number" ||
      !ADMIN_BUSINESS_EXTENSION_DAYS.includes(
        value.days as AdminBusinessExtensionDays,
      )
    ) {
      throw new AdminBusinessActionContractError("Geçersiz abonelik süresi.");
    }
    return {
      operation: "extend",
      days: value.days as AdminBusinessExtensionDays,
      expectedUpdatedAt: parseExpectedUpdatedAt(value.expectedUpdatedAt),
    };
  }

  if (value.operation === "setDate") {
    if (!hasExactKeys(value, SET_DATE_KEYS)) {
      throw new AdminBusinessActionContractError(
        "Tarih belirleme işlemi yalnızca bitiş tarihi ve güncelleme sürümü kabul eder.",
      );
    }
    if (typeof value.expiresOn !== "string" || !isValidCalendarDate(value.expiresOn)) {
      throw new AdminBusinessActionContractError("Abonelik bitiş tarihi geçersizdir.");
    }
    return {
      operation: "setDate",
      expiresOn: value.expiresOn,
      expectedUpdatedAt: parseExpectedUpdatedAt(value.expectedUpdatedAt),
    };
  }

  throw new AdminBusinessActionContractError("Geçersiz abonelik işlemi.");
}

export function buildAdminBusinessActionRpcBody(input: {
  businessId: string;
  action: AdminBusinessRpcAction;
  expectedUpdatedAt: string;
  actor: { userId: string; email: string };
  extensionDays?: AdminBusinessExtensionDays | null;
  expiresOn?: string | null;
}): AdminBusinessActionRpcBody {
  return {
    p_business_id: input.businessId,
    p_action: input.action,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_actor_user_id: input.actor.userId,
    p_actor_email: input.actor.email,
    p_extension_days:
      input.action === "extend_subscription" ? input.extensionDays ?? null : null,
    p_expires_on:
      input.action === "set_subscription_date" ? input.expiresOn ?? null : null,
  };
}

export function isExpectedAdminBusinessAuditAction(
  action: AdminBusinessRpcAction,
  auditAction: string,
) {
  return RPC_AUDIT_ACTIONS_BY_ACTION[action].has(auditAction);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

export function parseAdminBusinessActionRpcResult(
  value: unknown,
): AdminBusinessActionRpcResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;

  if (value.ok === false) {
    if (
      !hasExactKeys(value, RPC_FAILURE_KEYS) ||
      typeof value.code !== "string" ||
      !RPC_FAILURE_CODES.has(value.code)
    ) {
      return null;
    }
    return {
      ok: false,
      code: value.code as AdminBusinessActionFailure["code"],
    };
  }

  if (
    !hasExactKeys(value, RPC_SUCCESS_KEYS) ||
    !isRecord(value.business) ||
    !hasExactKeys(value.business, RPC_BUSINESS_KEYS) ||
    !isCanonicalBusinessUuid(String(value.business.id ?? "")) ||
    typeof value.business.isActive !== "boolean" ||
    (value.business.subscriptionStatus !== "active" &&
      value.business.subscriptionStatus !== "expired" &&
      value.business.subscriptionStatus !== "blocked") ||
    !isNullableTimestamp(value.business.subscriptionStartedAt) ||
    !isNullableTimestamp(value.business.subscriptionExpiresAt) ||
    !isTimestamp(value.business.updatedAt) ||
    typeof value.auditAction !== "string" ||
    !RPC_AUDIT_ACTIONS.has(value.auditAction)
  ) {
    return null;
  }

  return {
    ok: true,
    business: {
      id: value.business.id as string,
      isActive: value.business.isActive,
      subscriptionStatus: value.business.subscriptionStatus,
      subscriptionStartedAt: value.business.subscriptionStartedAt,
      subscriptionExpiresAt: value.business.subscriptionExpiresAt,
      updatedAt: value.business.updatedAt,
    },
    auditAction: value.auditAction,
  };
}
