import "server-only";

import { getSupabasePublicServerConfig } from "./config";
import {
  getVerifiedSupabaseIdentity,
  isActiveAdminEmail,
  readJsonBody,
  type AdminIdentity,
} from "./dal";
import { AdminError } from "./errors";
import {
  clearAdminSessionCookies,
  readAdminSessionCookies,
  writeAdminSessionCookies,
  type AdminAuthTokens,
} from "./session";

function parseAuthTokens(body: unknown): AdminAuthTokens | null {
  const value = body as
    | {
        access_token?: unknown;
        refresh_token?: unknown;
        expires_at?: unknown;
        expires_in?: unknown;
      }
    | null;

  if (
    typeof value?.access_token !== "string" ||
    !value.access_token.trim() ||
    typeof value.refresh_token !== "string" ||
    !value.refresh_token.trim()
  ) {
    return null;
  }

  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt:
      typeof value.expires_at === "number" ? value.expires_at : undefined,
    expiresIn:
      typeof value.expires_in === "number" ? value.expires_in : undefined,
  };
}

async function assertActiveAdmin(identity: AdminIdentity) {
  if (!(await isActiveAdminEmail(identity.email))) {
    throw new AdminError(
      "FORBIDDEN",
      "Bu hesap admin yetkisine sahip değil.",
      403,
    );
  }
  return identity;
}

async function exchangePassword(email: string, password: string) {
  const { url, anonKey } = getSupabasePublicServerConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (response.status === 400 || response.status === 401) {
    throw new AdminError(
      "UNAUTHORIZED",
      "E-posta veya şifre doğrulanamadı.",
      401,
    );
  }
  if (!response.ok) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Admin girişi şu anda tamamlanamıyor.",
      503,
    );
  }

  const tokens = parseAuthTokens(await readJsonBody(response));
  if (!tokens) {
    throw new AdminError(
      "UNAUTHORIZED",
      "Admin oturumu oluşturulamadı.",
      401,
    );
  }
  return tokens;
}

async function exchangeRefreshToken(refreshToken: string) {
  const { url, anonKey } = getSupabasePublicServerConfig();
  const response = await fetch(
    `${url}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new AdminError(
      "SESSION_EXPIRED",
      "Admin oturumunun süresi doldu.",
      401,
    );
  }

  const tokens = parseAuthTokens(await readJsonBody(response));
  if (!tokens) {
    throw new AdminError(
      "SESSION_EXPIRED",
      "Admin oturumunun süresi doldu.",
      401,
    );
  }
  return tokens;
}

async function verifyTokens(tokens: AdminAuthTokens) {
  const identity = await getVerifiedSupabaseIdentity(tokens.accessToken);
  if (!identity) {
    throw new AdminError(
      "UNAUTHORIZED",
      "Admin oturumu doğrulanamadı.",
      401,
    );
  }
  return assertActiveAdmin(identity);
}

export async function loginAdmin(email: string, password: string) {
  const tokens = await exchangePassword(email, password);
  const identity = await verifyTokens(tokens);
  await writeAdminSessionCookies(tokens);
  return identity;
}

export async function refreshAdminSession() {
  const { refreshToken } = await readAdminSessionCookies();
  if (!refreshToken) {
    await clearAdminSessionCookies();
    throw new AdminError(
      "SESSION_EXPIRED",
      "Admin oturumunun süresi doldu.",
      401,
    );
  }

  try {
    const tokens = await exchangeRefreshToken(refreshToken);
    const identity = await verifyTokens(tokens);
    await writeAdminSessionCookies(tokens);
    return identity;
  } catch (error) {
    await clearAdminSessionCookies();
    throw error;
  }
}

export async function requireAdmin() {
  const { accessToken } = await readAdminSessionCookies();
  if (!accessToken) {
    throw new AdminError(
      "UNAUTHORIZED",
      "Admin oturumu bulunamadı.",
      401,
    );
  }

  const identity = await getVerifiedSupabaseIdentity(accessToken);
  if (!identity) {
    throw new AdminError(
      "UNAUTHORIZED",
      "Admin oturumu doğrulanamadı.",
      401,
    );
  }

  return assertActiveAdmin(identity);
}

export async function logoutAdminSession() {
  const { accessToken } = await readAdminSessionCookies();
  try {
    if (accessToken) {
      const { url, anonKey } = getSupabasePublicServerConfig();
      await fetch(`${url}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });
    }
  } catch {
    // Local cookie cleanup must always win over a remote logout failure.
  } finally {
    await clearAdminSessionCookies();
  }
}
