import "server-only";

import { getSupabaseAdminServerConfig, getSupabasePublicServerConfig } from "./config";
import { AdminError } from "./errors";

export type AdminIdentity = {
  userId: string;
  email: string;
};

export async function readJsonBody(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function getVerifiedSupabaseIdentity(
  accessToken: string,
): Promise<AdminIdentity | null> {
  const { url, anonKey } = getSupabasePublicServerConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Admin kimliği doğrulanamadı.",
      503,
    );
  }

  const body = (await readJsonBody(response)) as
    | { id?: unknown; email?: unknown }
    | null;
  if (
    typeof body?.id !== "string" ||
    !body.id.trim() ||
    typeof body.email !== "string" ||
    !body.email.trim()
  ) {
    return null;
  }

  return {
    userId: body.id.trim(),
    email: body.email.trim().toLowerCase(),
  };
}

export async function isActiveAdminEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  const response = await adminServiceFetch(
    `/rest/v1/admin_users?email=eq.${encodeURIComponent(
      normalizedEmail,
    )}&is_active=eq.true&select=id&limit=1`,
  );
  const body = await readJsonBody(response);

  if (!response.ok || !Array.isArray(body)) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Admin yetkisi doğrulanamadı.",
      503,
    );
  }

  return body.length === 1;
}

export async function adminServiceFetch(path: string, init: RequestInit = {}) {
  const { url, serviceRoleKey } = getSupabaseAdminServerConfig();
  const headers = new Headers(init.headers);
  headers.set("apikey", serviceRoleKey);
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);

  return fetch(`${url}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}
