import { refreshAdminSession } from "../../../../../lib/admin/auth";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
} from "../../../../../lib/admin/http";

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    const identity = await refreshAdminSession();
    return adminJson({ authenticated: true, userId: identity.userId });
  } catch (error) {
    return adminErrorResponse(error, "Admin oturumu yenilenemedi.");
  }
}
