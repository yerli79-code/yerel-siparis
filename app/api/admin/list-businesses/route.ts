import { requireAdmin } from "../../../../lib/admin/auth";
import {
  AdminBusinessQueryError,
  parseAdminBusinessListQuery,
} from "../../../../lib/admin/business-list-contract";
import { fetchAdminBusinessPage } from "../../../../lib/admin/business-list";
import { AdminError } from "../../../../lib/admin/errors";
import {
  adminErrorResponse,
  adminJson,
} from "../../../../lib/admin/http";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const query = parseAdminBusinessListQuery(new URL(request.url).searchParams);
    return adminJson(await fetchAdminBusinessPage(query));
  } catch (error) {
    if (error instanceof AdminBusinessQueryError) {
      return adminErrorResponse(
        new AdminError(
          "INVALID_REQUEST",
          error.message,
          400,
        ),
      );
    }
    return adminErrorResponse(error, "İşletme listesi alınamadı.");
  }
}
