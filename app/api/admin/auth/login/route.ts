import { loginAdmin } from "../../../../../lib/admin/auth";
import { AdminError } from "../../../../../lib/admin/errors";
import {
  adminErrorResponse,
  adminJson,
  assertSameOriginAdminMutation,
} from "../../../../../lib/admin/http";

type LoginPayload = {
  email?: unknown;
  password?: unknown;
};

function validateLoginPayload(payload: LoginPayload) {
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (
    !email ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    password.length > 4096
  ) {
    throw new AdminError(
      "INVALID_REQUEST",
      "Geçerli e-posta ve şifre zorunludur.",
      400,
    );
  }

  return { email: email.toLowerCase(), password };
}

export async function POST(request: Request) {
  try {
    assertSameOriginAdminMutation(request);
    let payload: LoginPayload;
    try {
      payload = (await request.json()) as LoginPayload;
    } catch {
      throw new AdminError("INVALID_REQUEST", "Geçersiz istek gövdesi.", 400);
    }

    const credentials = validateLoginPayload(payload);
    const identity = await loginAdmin(credentials.email, credentials.password);
    return adminJson({ authenticated: true, userId: identity.userId });
  } catch (error) {
    return adminErrorResponse(error, "Admin girişi şu anda tamamlanamıyor.");
  }
}
