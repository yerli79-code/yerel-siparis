import { requireAdmin } from "../../../../../lib/admin/auth";
import { adminErrorResponse, adminJson } from "../../../../../lib/admin/http";

export async function GET() {
  try {
    const identity = await requireAdmin();
    return adminJson({ authenticated: true, userId: identity.userId });
  } catch (error) {
    return adminErrorResponse(error, "Admin oturumu doğrulanamadı.");
  }
}
