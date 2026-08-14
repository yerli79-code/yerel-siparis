import { requireAdmin } from "../../../../../lib/admin/auth";
import {
  AdminBusinessDetailContractError,
  isCanonicalUuid,
  parseAdminBusinessSafePatch,
} from "../../../../../lib/admin/business-detail-contract";
import {
  fetchAdminBusinessDetail,
  updateAdminBusinessSafely,
} from "../../../../../lib/admin/business-detail";
import { AdminError } from "../../../../../lib/admin/errors";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
  invalidAdminRequest,
} from "../../../../../lib/admin/http";

type RouteContext = { params: Promise<{ id: string }> };

async function readBusinessId(context: RouteContext) {
  const { id } = await context.params;
  if (!isCanonicalUuid(id)) invalidAdminRequest("Geçerli bir işletme UUID bilgisi zorunludur.");
  return id;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const id = await readBusinessId(context);
    const detail = await fetchAdminBusinessDetail(id);
    if (!detail) throw new AdminError("NOT_FOUND", "İşletme bulunamadı.", 404);
    return adminJson(detail);
  } catch (error) {
    return adminErrorResponse(error, "İşletme bilgileri yüklenemedi.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertSameOriginAdminMutation(request);
    await requireAdmin();
    const id = await readBusinessId(context);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      invalidAdminRequest("Geçersiz istek gövdesi.");
    }

    let patch;
    try {
      patch = parseAdminBusinessSafePatch(body);
    } catch (error) {
      if (error instanceof AdminBusinessDetailContractError) {
        invalidAdminRequest(error.message);
      }
      throw error;
    }
    return adminJson({ business: await updateAdminBusinessSafely(id, patch) });
  } catch (error) {
    return adminErrorResponse(error, "İşletme kaydedilemedi.");
  }
}
