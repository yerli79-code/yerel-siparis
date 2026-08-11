export type AdminSessionDTO = {
  authenticated: true;
  userId: string;
};

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
