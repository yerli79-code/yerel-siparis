import "server-only";

import {
  ADMIN_BUSINESS_AUDIT_HISTORY_LIMIT,
  ADMIN_BUSINESS_AUDIT_HISTORY_SELECT,
  type AdminBusinessAuditItem,
  type AdminBusinessAuditSnapshot,
} from "./business-audit-history-contract";
import { isCanonicalUuid } from "./business-detail-contract";
import { adminServiceFetch, readJsonBody } from "./dal";
import { AdminError } from "./errors";

type AuditRow = {
  id?: unknown;
  action?: unknown;
  actor_email?: unknown;
  created_at?: unknown;
  before_state?: unknown;
  after_state?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function mapSnapshot(value: unknown): AdminBusinessAuditSnapshot | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.is_active !== "boolean" ||
    (value.subscription_status !== "active" &&
      value.subscription_status !== "expired" &&
      value.subscription_status !== "blocked") ||
    !isNullableTimestamp(value.subscription_started_at) ||
    !isNullableTimestamp(value.subscription_expires_at)
  ) {
    return null;
  }

  return {
    isActive: value.is_active,
    subscriptionStatus: value.subscription_status,
    subscriptionStartedAt: value.subscription_started_at,
    subscriptionExpiresAt: value.subscription_expires_at,
  };
}

function mapAuditRow(row: AuditRow): AdminBusinessAuditItem | null {
  const before = mapSnapshot(row.before_state);
  const after = mapSnapshot(row.after_state);
  if (
    typeof row.id !== "string" ||
    !isCanonicalUuid(row.id) ||
    typeof row.action !== "string" ||
    !row.action.trim() ||
    typeof row.actor_email !== "string" ||
    !row.actor_email.trim() ||
    !isTimestamp(row.created_at) ||
    !before ||
    !after
  ) {
    return null;
  }

  return {
    id: row.id,
    action: row.action.trim(),
    actorEmail: row.actor_email.trim(),
    createdAt: row.created_at,
    before,
    after,
  };
}

async function businessExists(businessId: string) {
  const params = new URLSearchParams({
    id: `eq.${businessId}`,
    select: "id",
    limit: "1",
  });
  const response = await adminServiceFetch(`/rest/v1/businesses?${params}`);
  const body = await readJsonBody(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşletme kaydı doğrulanamadı.",
      503,
    );
  }
  if (body.length === 0) return false;
  if (
    body.length !== 1 ||
    typeof body[0]?.id !== "string" ||
    body[0].id.toLowerCase() !== businessId.toLowerCase()
  ) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşletme kaydı doğrulanamadı.",
      503,
    );
  }
  return true;
}

export async function fetchAdminBusinessAuditHistory(
  businessId: string,
): Promise<AdminBusinessAuditItem[] | null> {
  if (!(await businessExists(businessId))) return null;

  const params = new URLSearchParams({
    business_id: `eq.${businessId}`,
    select: ADMIN_BUSINESS_AUDIT_HISTORY_SELECT,
    order: "created_at.desc,id.desc",
    limit: String(ADMIN_BUSINESS_AUDIT_HISTORY_LIMIT),
  });
  const response = await adminServiceFetch(`/rest/v1/admin_audit_logs?${params}`);
  const body = await readJsonBody(response);
  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşlem geçmişi şu anda alınamıyor.",
      503,
    );
  }

  const items = (body as AuditRow[]).map(mapAuditRow);
  if (items.some((item) => item === null)) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "İşlem geçmişi şu anda alınamıyor.",
      503,
    );
  }
  return items as AdminBusinessAuditItem[];
}
