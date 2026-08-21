import { requireAdmin } from "../../../../../../lib/admin/auth";
import { fetchAdminBusinessAuditHistory } from "../../../../../../lib/admin/business-audit-history";
import { isCanonicalUuid } from "../../../../../../lib/admin/business-detail-contract";
import { AdminError } from "../../../../../../lib/admin/errors";
import {
  adminErrorResponse,
  adminJson,
  invalidAdminRequest,
} from "../../../../../../lib/admin/http";

type RouteContext = { params: Promise<{ id: string }> };

async function readBusinessId(context: RouteContext) {
  const { id } = await context.params;
  if (!isCanonicalUuid(id)) {
    invalidAdminRequest("Geçerli bir işletme UUID bilgisi zorunludur.");
  }
  return id;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireAdmin();
    const id = await readBusinessId(context);
    const items = await fetchAdminBusinessAuditHistory(id);
    if (!items) throw new AdminError("NOT_FOUND", "İşletme bulunamadı.", 404);
    return adminJson({ items });
  } catch (error) {
    return adminErrorResponse(error, "İşlem geçmişi yüklenemedi.");
  }
}
