import "server-only";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_ACCESS_COOKIE = "yerel-siparis-admin-access-token";
export const ADMIN_REFRESH_COOKIE = "yerel-siparis-admin-refresh-token";
const ADMIN_SESSION_COOKIE = "yerel-siparis-admin-session";

function sessionCookieNames(sessionId: string) {
  return {
    gate: `yerel-siparis-admin-gate-${sessionId}`,
    access: `${ADMIN_ACCESS_COOKIE}-${sessionId}`,
    refresh: `${ADMIN_REFRESH_COOKIE}-${sessionId}`,
  };
}

function validSessionId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

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
  const sessionId = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? "";
  const names = validSessionId(sessionId) ? sessionCookieNames(sessionId) : null;
  // The gate is created ONLY by password login. Refresh may rotate credentials,
  // but can never recreate this capability after logout/recovery/failure.
  const active = names && cookieStore.get(names.gate)?.value === "active";
  return {
    sessionId: names ? sessionId : "",
    accessToken: active ? cookieStore.get(names.access)?.value?.trim() || "" : "",
    refreshToken: active ? cookieStore.get(names.refresh)?.value?.trim() || "" : "",
  };
}

export async function startAdminSessionCookies(tokens: AdminAuthTokens) {
  await clearAdminSessionCookies();
  const cookieStore = await cookies();
  const sessionId = randomUUID();
  cookieStore.set(ADMIN_SESSION_COOKIE, sessionId, cookieOptions(REFRESH_MAX_AGE_SECONDS));
  cookieStore.set(sessionCookieNames(sessionId).gate, "active", cookieOptions(REFRESH_MAX_AGE_SECONDS));
  await writeAdminSessionCookies(tokens, sessionId);
}

export async function writeAdminSessionCookies(tokens: AdminAuthTokens, sessionId: string) {
  if (!validSessionId(sessionId)) throw new Error("Invalid admin session namespace");
  const cookieStore = await cookies();
  const policy = getAdminCookiePolicy(tokens);
  const names = sessionCookieNames(sessionId);
  cookieStore.set(names.access, tokens.accessToken, policy.access);
  cookieStore.set(names.refresh, tokens.refreshToken, policy.refresh);
}

export async function clearAdminSessionCookies(sessionId?: string) {
  const cookieStore = await cookies();
  const target = sessionId ?? cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? "";
  const expired = {
    ...cookieOptions(0),
    expires: new Date(0),
  };
  cookieStore.set(ADMIN_ACCESS_COOKIE, "", expired);
  cookieStore.set(ADMIN_REFRESH_COOKIE, "", expired);
  if (validSessionId(target)) {
    for (const name of Object.values(sessionCookieNames(target))) {
      cookieStore.set(name, "", expired);
    }
  }
  // Keep the inert selector: deleting a shared cookie from an old response could
  // log out a newer login. It grants no access without its login-only gate.
  // A delayed refresh can leave orphan credentials, never an active session.
}
