import { requireAdmin } from "../../../../../../lib/admin/auth";
import {
  AdminBusinessActionContractError,
  isCanonicalBusinessUuid,
  parseAdminBusinessSimpleActionRequest,
} from "../../../../../../lib/admin/business-actions-contract";
import { applyAdminBusinessAction } from "../../../../../../lib/admin/business-actions";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
  invalidAdminRequest,
} from "../../../../../../lib/admin/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    assertSameOriginAdminMutation(request);
    const actor = await requireAdmin();
    const { id } = await context.params;
    if (!isCanonicalBusinessUuid(id)) {
      invalidAdminRequest("Geçerli bir işletme UUID bilgisi zorunludur.");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      invalidAdminRequest("Geçersiz istek gövdesi.");
    }

    let payload;
    try {
      payload = parseAdminBusinessSimpleActionRequest(body);
    } catch (error) {
      if (error instanceof AdminBusinessActionContractError) {
        invalidAdminRequest(error.message);
      }
      throw error;
    }

    return adminJson(
      await applyAdminBusinessAction({
        businessId: id,
        action: "deactivate",
        expectedUpdatedAt: payload.expectedUpdatedAt,
        actor,
      }),
    );
  } catch (error) {
    return adminErrorResponse(
      error,
      "İşlem şu anda tamamlanamadı. Lütfen tekrar deneyin.",
    );
  }
}
