export type AdminSessionDTO = {
  authenticated: true;
  userId: string;
};

const LEGACY_ADMIN_SESSION_KEY = "yerel-siparis-admin-auth-session";
const LEGACY_ADMIN_BUSINESS_CACHE_KEY = "yerel-siparis-businesses-v2";

export function clearLegacyAdminBrowserSession() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(LEGACY_ADMIN_SESSION_KEY);
  } catch {
    // Legacy storage cleanup must not prevent the admin UI from starting.
  }
}

export function clearLegacyAdminBusinessCache() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(LEGACY_ADMIN_BUSINESS_CACHE_KEY);
  } catch {
    // Legacy PII cleanup must not prevent the server-backed admin UI from starting.
  }
}

async function refreshAdminSession() {
  try {
    const response = await fetch("/api/admin/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function requestAdminApi(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const requestInit = { ...init, credentials: "same-origin" as const };
  let response = await fetch(input, requestInit);

  if (response.status === 401 && (await refreshAdminSession())) {
    response = await fetch(input, requestInit);
  }

  return response;
}

export async function readAdminSession() {
  const response = await requestAdminApi("/api/admin/auth/session", {
    method: "GET",
  });
  if (!response.ok) return null;

  const body = (await response.json()) as Partial<AdminSessionDTO>;
  if (body.authenticated !== true || typeof body.userId !== "string") {
    return null;
  }

  return { authenticated: true, userId: body.userId } satisfies AdminSessionDTO;
}

export async function loginAdmin(email: string, password: string) {
  const response = await fetch("/api/admin/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  return response.ok;
}

export async function logoutAdmin() {
  try {
    await fetch("/api/admin/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } catch {
    // The browser state is reset even when remote logout is unavailable.
  }
}
