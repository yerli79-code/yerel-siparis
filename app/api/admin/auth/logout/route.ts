import { logoutAdminSession } from "../../../../../lib/admin/auth";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
} from "../../../../../lib/admin/http";

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    await logoutAdminSession();
    return adminJson({ authenticated: false });
  } catch (error) {
    return adminErrorResponse(error, "Admin çıkışı tamamlanamadı.");
  }
}
