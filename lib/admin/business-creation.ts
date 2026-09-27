import "server-only";

import { adminServiceFetch, readJsonBody, type AdminIdentity } from "./dal";
import { AdminError } from "./errors";

export const ADMIN_CREATE_BUSINESS_RPC_PATH =
  "/rest/v1/rpc/admin_create_business_with_audit";

export type CreateBusinessInput = {
  businessId: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string;
  whatsappOrderNumber: string;
  city: string;
  district: string;
  neighborhood: string;
  address: string;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  isActive: boolean;
  actor: AdminIdentity;
};

export type CreatedBusiness = {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  [key: string]: unknown;
};

export type CreationOutcome =
  | { kind: "success"; business: CreatedBusiness }
  | { kind: "known-failure"; error: AdminError }
  | { kind: "ambiguous" };

type ServiceFetch = (path: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBusiness(value: unknown, id: string): CreatedBusiness | null {
  if (!isRecord(value) || value.id !== id ||
      typeof value.owner_id !== "string" ||
      typeof value.slug !== "string" || !value.slug ||
      typeof value.name !== "string" || !value.name) return null;
  return value as CreatedBusiness;
}

export async function createBusinessWithAudit(
  input: CreateBusinessInput,
  serviceFetch: ServiceFetch = adminServiceFetch,
): Promise<CreationOutcome> {
  const body = {
    p_business_id: input.businessId,
    p_owner_id: input.ownerId,
    p_slug: input.slug,
    p_name: input.name,
    p_description: input.description,
    p_whatsapp_order_number: input.whatsappOrderNumber,
    p_city: input.city,
    p_district: input.district,
    p_neighborhood: input.neighborhood,
    p_address: input.address,
    p_subscription_status: input.subscriptionStatus,
    p_subscription_started_at: input.subscriptionStartedAt,
    p_subscription_expires_at: input.subscriptionExpiresAt,
    p_is_active: input.isActive,
    p_actor_user_id: input.actor.userId,
    p_actor_email: input.actor.email,
  };
  let response: Response;
  let result: unknown;
  try {
    response = await serviceFetch(ADMIN_CREATE_BUSINESS_RPC_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    result = await readJsonBody(response);
  } catch {
    return { kind: "ambiguous" };
  }

  if (!response.ok) {
    const code = isRecord(result) ? result.code : null;
    if (code === "23505") {
      return {
        kind: "known-failure",
        error: new AdminError("DUPLICATE_SLUG", "Bu slug zaten kullanılıyor.", 409),
      };
    }
    if (code === "22023") {
      return {
        kind: "known-failure",
        error: new AdminError("INVALID_REQUEST", "İşletme bilgileri geçersiz.", 400),
      };
    }
    return { kind: "ambiguous" };
  }

  const business = isRecord(result) && result.ok === true
    ? parseBusiness(result.business, input.businessId)
    : null;
  return business ? { kind: "success", business } : { kind: "ambiguous" };
}

export type Reconciliation =
  | { kind: "committed"; business: CreatedBusiness }
  | { kind: "not-committed" }
  | { kind: "unknown" };

export async function reconcileBusinessCreation(
  businessId: string,
  serviceFetch: ServiceFetch = adminServiceFetch,
): Promise<Reconciliation> {
  try {
    const businessQuery = new URLSearchParams({
      id: `eq.${businessId}`,
      select: "id,owner_id,slug,name,description,whatsapp_order_number,created_at,category,city,district,neighborhood,address,delivery_status,logo_text,subscription_status,subscription_started_at,subscription_expires_at,is_active",
      limit: "2",
    });
    const auditQuery = new URLSearchParams({
      business_id: `eq.${businessId}`,
      action: "eq.business.created",
      select: "id,business_id,action",
      limit: "2",
    });
    const [businessResponse, auditResponse] = await Promise.all([
      serviceFetch(`/rest/v1/businesses?${businessQuery}`),
      serviceFetch(`/rest/v1/admin_audit_logs?${auditQuery}`),
    ]);
    const [businesses, audits] = await Promise.all([
      readJsonBody(businessResponse),
      readJsonBody(auditResponse),
    ]);
    if (!businessResponse.ok || !auditResponse.ok ||
        !Array.isArray(businesses) || !Array.isArray(audits) ||
        businesses.length > 1 || audits.length > 1) return { kind: "unknown" };

    const business = businesses.length === 1
      ? parseBusiness(businesses[0], businessId)
      : null;
    const audit = audits[0];
    if (businesses.length === 1 && !business) return { kind: "unknown" };
    if (audits.length === 1 && (!isRecord(audit) ||
        typeof audit.id !== "string" ||
        audit.business_id !== businessId ||
        audit.action !== "business.created")) return { kind: "unknown" };
    if (business && audit) return { kind: "committed", business };
    if (!business && !audit) return { kind: "not-committed" };
    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
