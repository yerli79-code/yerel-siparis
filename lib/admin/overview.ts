import "server-only";

import { adminServiceFetch } from "./dal";
import { AdminError } from "./errors";
import { parsePostgrestTotal } from "./business-list-contract";
import type { AdminKpis } from "../subscription";

async function countBusinesses(filters: ReadonlyArray<readonly [string, string]>) {
  const params = new URLSearchParams({ select: "id" });
  for (const [name, value] of filters) params.append(name, value);
  const response = await adminServiceFetch(`/rest/v1/businesses?${params}`, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  if (!response.ok) {
    throw new AdminError("ADMIN_UNAVAILABLE", "Yönetim özeti alınamadı.", 503);
  }

  try {
    return parsePostgrestTotal(response.headers.get("content-range"));
  } catch {
    throw new AdminError("ADMIN_UNAVAILABLE", "Yönetim özeti alınamadı.", 503);
  }
}

export async function fetchAdminOverview(): Promise<AdminKpis> {
  const now = new Date();
  const nowIso = now.toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const activeSubscriptionFilters = [
    ["is_active", "eq.true"],
    ["subscription_status", "eq.active"],
    ["subscription_expires_at", `gt.${nowIso}`],
  ] as const;

  const [
    total,
    active,
    inactive,
    createdLastSevenDays,
    activeSubscriptions,
    expiringSubscriptions,
  ] = await Promise.all([
    countBusinesses([]),
    countBusinesses([["is_active", "eq.true"]]),
    countBusinesses([["is_active", "eq.false"]]),
    countBusinesses([
      ["created_at", `gte.${sevenDaysAgo}`],
      ["created_at", `lte.${nowIso}`],
    ]),
    countBusinesses(activeSubscriptionFilters),
    countBusinesses([
      ...activeSubscriptionFilters,
      ["subscription_expires_at", `lte.${thirtyDaysLater}`],
    ]),
  ]);

  return {
    total,
    active,
    inactive,
    createdLastSevenDays,
    activeSubscriptions,
    expiringSubscriptions,
  };
}
