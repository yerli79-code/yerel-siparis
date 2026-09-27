import { requireAdmin } from "../../../../lib/admin/auth";
import { AdminError } from "../../../../lib/admin/errors";
import {
  adminErrorResponse,
  assertSameOriginAdminMutation,
} from "../../../../lib/admin/http";

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    await requireAdmin();

    throw new AdminError(
      "LEGACY_ENDPOINT_RETIRED",
      "Eski işletme güncelleme uç noktası kullanımdan kaldırıldı. Lütfen PATCH /api/admin/businesses/[id] uç noktasını kullanın.",
      410,
    );
  } catch (error) {
    return adminErrorResponse(
      error,
      "İşletme güncelleme uç noktası kullanımdan kaldırıldı.",
    );
  }
}
