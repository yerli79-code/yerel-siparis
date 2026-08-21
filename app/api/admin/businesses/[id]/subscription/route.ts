import { requireAdmin } from "../../../../../../lib/admin/auth";
import {
  AdminBusinessActionContractError,
  isCanonicalBusinessUuid,
  parseAdminBusinessSubscriptionRequest,
} from "../../../../../../lib/admin/business-actions-contract";
import { applyAdminBusinessAction } from "../../../../../../lib/admin/business-actions";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
  invalidAdminRequest,
} from "../../../../../../lib/admin/http";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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
      payload = parseAdminBusinessSubscriptionRequest(body);
    } catch (error) {
      if (error instanceof AdminBusinessActionContractError) {
        invalidAdminRequest(error.message);
      }
      throw error;
    }

    if (payload.operation === "extend") {
      return adminJson(
        await applyAdminBusinessAction({
          businessId: id,
          action: "extend_subscription",
          expectedUpdatedAt: payload.expectedUpdatedAt,
          actor,
          extensionDays: payload.days,
        }),
      );
    }

    return adminJson(
      await applyAdminBusinessAction({
        businessId: id,
        action: "set_subscription_date",
        expectedUpdatedAt: payload.expectedUpdatedAt,
        actor,
        expiresOn: payload.expiresOn,
      }),
    );
  } catch (error) {
    return adminErrorResponse(
      error,
      "İşlem şu anda tamamlanamadı. Lütfen tekrar deneyin.",
    );
  }
}
