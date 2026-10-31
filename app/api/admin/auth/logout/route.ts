import { logoutAdminSession } from "../../../../../lib/admin/auth";
import { clearAdminSessionCookies } from "../../../../../lib/admin/session";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
} from "../../../../../lib/admin/http";

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    // Recovery discards this browser's admin cookies without revoking a
    // different account's sessions on other devices.
    if (new URL(request.url).searchParams.get("scope") === "browser") {
      await clearAdminSessionCookies();
    } else await logoutAdminSession();
    return adminJson({ authenticated: false });
  } catch (error) {
    return adminErrorResponse(error, "Admin çıkışı tamamlanamadı.");
  }
}
