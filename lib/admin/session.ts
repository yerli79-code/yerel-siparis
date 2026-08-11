import "server-only";

import { cookies } from "next/headers";

export const ADMIN_ACCESS_COOKIE = "yerel-siparis-admin-access-token";
export const ADMIN_REFRESH_COOKIE = "yerel-siparis-admin-refresh-token";

const DEFAULT_ACCESS_MAX_AGE_SECONDS = 60 * 60;
const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AdminAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: number;
  expiresIn?: number;
};

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    priority: "high" as const,
  };
}

export function getAdminCookiePolicy(tokens?: AdminAuthTokens) {
  const expiresFromToken = tokens?.expiresAt
    ? Math.floor(tokens.expiresAt - Date.now() / 1000)
    : tokens?.expiresIn;
  const accessMaxAge =
    typeof expiresFromToken === "number" && Number.isFinite(expiresFromToken)
      ? Math.max(1, Math.floor(expiresFromToken))
      : DEFAULT_ACCESS_MAX_AGE_SECONDS;

  return {
    access: cookieOptions(accessMaxAge),
    refresh: cookieOptions(REFRESH_MAX_AGE_SECONDS),
  };
}

export async function readAdminSessionCookies() {
  const cookieStore = await cookies();
  return {
    accessToken: cookieStore.get(ADMIN_ACCESS_COOKIE)?.value?.trim() || "",
    refreshToken: cookieStore.get(ADMIN_REFRESH_COOKIE)?.value?.trim() || "",
  };
}

export async function writeAdminSessionCookies(tokens: AdminAuthTokens) {
  const cookieStore = await cookies();
  const policy = getAdminCookiePolicy(tokens);
  cookieStore.set(ADMIN_ACCESS_COOKIE, tokens.accessToken, policy.access);
  cookieStore.set(ADMIN_REFRESH_COOKIE, tokens.refreshToken, policy.refresh);
}

export async function clearAdminSessionCookies() {
  const cookieStore = await cookies();
  const expired = {
    ...cookieOptions(0),
    expires: new Date(0),
  };
  cookieStore.set(ADMIN_ACCESS_COOKIE, "", expired);
  cookieStore.set(ADMIN_REFRESH_COOKIE, "", expired);
}
