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
      "Kalıcı işletme silme işlemi devre dışı bırakıldı. Erişimi kapatmak için işletme durum kontrollerini kullanın.",
      410,
    );
  } catch (error) {
    return adminErrorResponse(
      error,
      "Kalıcı işletme silme işlemi devre dışı bırakıldı.",
    );
  }
}
