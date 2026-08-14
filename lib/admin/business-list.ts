import "server-only";

import { adminServiceFetch, readJsonBody } from "./dal";
import { AdminError } from "./errors";
import {
  buildAdminBusinessRestParams,
  buildOwnerEmailSearchParams,
  getAdminBusinessRange,
  getAdminBusinessTotalPages,
  parsePostgrestTotal,
  type AdminBusinessListItem,
  type AdminBusinessListQuery,
  type AdminBusinessListResponse,
} from "./business-list-contract";

type BusinessRow = {
  id?: string | null;
  owner_id?: string | null;
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  whatsapp_order_number?: string | null;
  created_at?: string | null;
  category?: string | null;
  city?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  delivery_status?: string | null;
  logo_text?: string | null;
  subscription_status?: "active" | "expired" | "blocked" | null;
  subscription_started_at?: string | null;
  subscription_expires_at?: string | null;
  is_active?: boolean | null;
};

type ProfileRow = {
  id?: string | null;
  email?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_SEARCH_BATCH_SIZE = 1000;

async function fetchMatchingOwnerIds(q: string) {
  if (!q) return [];

  const ids: string[] = [];
  const baseParams = buildOwnerEmailSearchParams(q);
  for (let offset = 0; ; offset += OWNER_SEARCH_BATCH_SIZE) {
    const params = new URLSearchParams(baseParams);
    params.set("limit", String(OWNER_SEARCH_BATCH_SIZE));
    params.set("offset", String(offset));
    const response = await adminServiceFetch(`/rest/v1/profiles?${params}`);
    const body = await readJsonBody(response);
    if (!response.ok || !Array.isArray(body)) {
      throw new AdminError("ADMIN_UNAVAILABLE", "İşletme listesi alınamadı.", 503);
    }

    const pageIds = (body as ProfileRow[])
      .map((profile) => profile.id)
      .filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id));
    ids.push(...pageIds);
    if (body.length < OWNER_SEARCH_BATCH_SIZE) break;
  }
  return ids;
}

async function fetchProfileEmails(ownerIds: string[]) {
  if (ownerIds.length === 0) return new Map<string, string>();

  const safeOwnerIds = Array.from(new Set(ownerIds.filter((id) => UUID_PATTERN.test(id))));
  const params = new URLSearchParams();
  params.set("id", `in.(${safeOwnerIds.join(",")})`);
  params.set("select", "id,email");
  const response = await adminServiceFetch(`/rest/v1/profiles?${params}`);
  const body = await readJsonBody(response);
  if (!response.ok || !Array.isArray(body)) return new Map<string, string>();

  return new Map(
    (body as ProfileRow[])
      .filter(
        (profile): profile is { id: string; email: string } =>
          typeof profile.id === "string" && typeof profile.email === "string",
      )
      .map((profile) => [profile.id, profile.email]),
  );
}

function mapBusinessRow(
  row: BusinessRow,
  profileEmails: ReadonlyMap<string, string>,
): AdminBusinessListItem | null {
  if (typeof row.id !== "string" || typeof row.slug !== "string") return null;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name ?? row.slug,
    description: row.description ?? "",
    whatsappOrderNumber: row.whatsapp_order_number ?? "",
    email:
      typeof row.owner_id === "string" ? profileEmails.get(row.owner_id) ?? "" : "",
    createdAt: row.created_at ?? "",
    category: row.category ?? "",
    city: row.city ?? "",
    district: row.district ?? "",
    neighborhood: row.neighborhood ?? "",
    address: row.address ?? "",
    deliveryStatus: row.delivery_status ?? "",
    logoText: row.logo_text ?? "",
    subscriptionStatus: row.subscription_status ?? "expired",
    subscriptionStartedAt: row.subscription_started_at ?? null,
    subscriptionExpiresAt: row.subscription_expires_at ?? null,
    isActive: row.is_active ?? false,
  };
}

export async function fetchAdminBusinessPage(
  query: AdminBusinessListQuery,
): Promise<AdminBusinessListResponse> {
  const now = new Date();
  const ownerIds = await fetchMatchingOwnerIds(query.q);
  const params = buildAdminBusinessRestParams(query, ownerIds, now);
  const { from, to } = getAdminBusinessRange(query.page, query.pageSize);
  const response = await adminServiceFetch(`/rest/v1/businesses?${params}`, {
    headers: {
      Prefer: "count=exact",
      Range: `${from}-${to}`,
      "Range-Unit": "items",
    },
  });
  const body = await readJsonBody(response);

  if (response.status === 416) {
    try {
      const total = parsePostgrestTotal(response.headers.get("content-range"));
      return {
        items: [],
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: getAdminBusinessTotalPages(total, query.pageSize),
        },
      };
    } catch {
      throw new AdminError("ADMIN_UNAVAILABLE", "İşletme listesi alınamadı.", 503);
    }
  }

  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme listesi alınamadı.", 503);
  }

  let total: number;
  try {
    total = parsePostgrestTotal(response.headers.get("content-range"));
  } catch {
    throw new AdminError("ADMIN_UNAVAILABLE", "İşletme listesi alınamadı.", 503);
  }

  const rows = body as BusinessRow[];
  const profileEmails = await fetchProfileEmails(
    rows
      .map((row) => row.owner_id)
      .filter((id): id is string => typeof id === "string"),
  );
  const items = rows
    .map((row) => mapBusinessRow(row, profileEmails))
    .filter((item): item is AdminBusinessListItem => item !== null);

  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: getAdminBusinessTotalPages(total, query.pageSize),
    },
  };
}
