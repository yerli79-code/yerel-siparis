import "server-only";

import { adminServiceFetch, readJsonBody, type AdminIdentity } from "./dal";
import { AdminError } from "./errors";
import {
  buildAdminBusinessActionRpcBody,
  isExpectedAdminBusinessAuditAction,
  parseAdminBusinessActionRpcResult,
  type AdminBusinessActionRpcBody,
  type AdminBusinessCriticalDto,
  type AdminBusinessExtensionDays,
  type AdminBusinessRpcAction,
} from "./business-actions-contract";

export const ADMIN_BUSINESS_ACTION_RPC_PATH =
  "/rest/v1/rpc/admin_apply_business_action";

export type ApplyAdminBusinessActionInput = {
  businessId: string;
  action: AdminBusinessRpcAction;
  expectedUpdatedAt: string;
  actor: AdminIdentity;
  extensionDays?: AdminBusinessExtensionDays | null;
  expiresOn?: string | null;
};

export type ApplyAdminBusinessActionResult = {
  business: AdminBusinessCriticalDto;
  auditAction: string;
};

type AdminBusinessActionServiceFetch = (
  path: string,
  init: RequestInit,
) => Promise<Response>;

function unavailable(): never {
  throw new AdminError(
    "ADMIN_UNAVAILABLE",
    "İşlem şu anda tamamlanamadı. Lütfen tekrar deneyin.",
    503,
  );
}

function mapLogicalFailure(code: "NOT_FOUND" | "CONFLICT" | "INVALID_STATE"): never {
  if (code === "NOT_FOUND") {
    throw new AdminError("NOT_FOUND", "İşletme bulunamadı.", 404);
  }
  if (code === "CONFLICT") {
    throw new AdminError(
      "CONFLICT",
      "İşletme başka bir işlemde güncellendi. Güncel bilgileri yükleyip tekrar deneyin.",
      409,
    );
  }
  throw new AdminError(
    "INVALID_STATE",
    "İşletmenin mevcut durumu bu işleme izin vermiyor.",
    409,
  );
}

export async function applyAdminBusinessAction(
  input: ApplyAdminBusinessActionInput,
  serviceFetch: AdminBusinessActionServiceFetch = adminServiceFetch,
): Promise<ApplyAdminBusinessActionResult> {
  const rpcBody: AdminBusinessActionRpcBody = buildAdminBusinessActionRpcBody(input);
  let response: Response;
  let body: unknown;

  try {
    response = await serviceFetch(ADMIN_BUSINESS_ACTION_RPC_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcBody),
    });
    body = await readJsonBody(response);
  } catch {
    return unavailable();
  }

  if (!response.ok) return unavailable();

  const result = parseAdminBusinessActionRpcResult(body);
  if (!result) return unavailable();
  if (!result.ok) return mapLogicalFailure(result.code);
  if (result.business.id !== input.businessId) return unavailable();
  if (!isExpectedAdminBusinessAuditAction(input.action, result.auditAction)) {
    return unavailable();
  }

  return {
    business: result.business,
    auditAction: result.auditAction,
  };
}
