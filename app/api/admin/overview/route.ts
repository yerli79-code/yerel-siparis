import { requireAdmin } from "../../../../lib/admin/auth";
import { fetchAdminOverview } from "../../../../lib/admin/overview";
import { adminErrorResponse, adminJson } from "../../../../lib/admin/http";

export async function GET() {
  try {
    await requireAdmin();
    return adminJson(await fetchAdminOverview());
  } catch (error) {
    return adminErrorResponse(error, "Yönetim özeti alınamadı.");
  }
}
