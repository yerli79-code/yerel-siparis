export type BrowserAuthSession = {
  generation?: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user?: {
    id?: string;
    email?: string;
  };
};

type BrowserAuthConfig = {
  url: string;
  publishableKey: string;
  sessionKey: string;
};

const tokenRefreshMarginMs = 60 * 1000;
const refreshLocks = new Map<string, Promise<string | null>>();
const localGenerations = new Map<string, string>();
export const businessSessionKey = "yerel-siparis-business-session";
export const authGenerationKey = (sessionKey: string) => `${sessionKey}-generation`;

function generation(sessionKey: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage?.getItem(authGenerationKey(sessionKey)) ?? localGenerations.get(sessionKey) ?? "";
  } catch { return localGenerations.get(sessionKey) ?? ""; }
}

function isCurrentSession(sessionKey: string, session: BrowserAuthSession) {
  const current = readBrowserAuthSession(sessionKey);
  return current?.refresh_token === session.refresh_token && current?.generation === session.generation;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidExpiresAt(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

async function safeReadJson(response: Response) {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function normalizeAuthSessionBody(body: unknown, requireExpiresAt = true) {
  const session = body as Partial<BrowserAuthSession> | null;
  if (
    !isNonEmptyString(session?.access_token) ||
    !isNonEmptyString(session?.refresh_token) ||
    !isValidExpiresAt(session.expires_at)
  ) {
    return null;
  }

  if (requireExpiresAt && typeof session.expires_at !== "number") {
    return null;
  }

  return {
    generation: typeof (body as BrowserAuthSession).generation === "string" ? (body as BrowserAuthSession).generation : "",
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: session.user,
  } satisfies BrowserAuthSession;
}

export function readBrowserAuthSession(sessionKey: string) {
  if (typeof window === "undefined") return null;

  const stored = window.sessionStorage.getItem(sessionKey);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored) as Partial<BrowserAuthSession>;
    const session = normalizeAuthSessionBody(parsed, false);
    if (!session) {
      clearBrowserAuthSession(sessionKey);
      return null;
    }
    if ((session.generation ?? "") !== generation(sessionKey)) {
      window.sessionStorage.removeItem(sessionKey);
      return null;
    }

    return {
      generation: session.generation,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      user: session.user,
    } satisfies BrowserAuthSession;
  } catch {
    clearBrowserAuthSession(sessionKey);
    return null;
  }
}

export function saveBrowserAuthSession(sessionKey: string, session: BrowserAuthSession) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(sessionKey, JSON.stringify({ ...session, generation: generation(sessionKey) }));
}

export function clearBrowserAuthSession(sessionKey: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(sessionKey);
  const next = crypto.randomUUID();
  localGenerations.set(sessionKey, next);
  refreshLocks.delete(sessionKey);
  try { window.localStorage?.setItem(authGenerationKey(sessionKey), next); } catch { /* Same-tab invalidation still applies. */ }
}

export async function signInWithPassword(
  config: BrowserAuthConfig,
  email: string,
  password: string,
) {
  clearBrowserAuthSession(config.sessionKey);
  const startedGeneration = generation(config.sessionKey);
  let response: Response;

  try {
    response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return null;
  }

  const body = await safeReadJson(response);
  if (!response.ok) return null;

  const session = normalizeAuthSessionBody(body);
  if (!session || startedGeneration !== generation(config.sessionKey)) return null;

  saveBrowserAuthSession(config.sessionKey, session);
  return session;
}

async function refreshAuthSession(config: BrowserAuthConfig, session: BrowserAuthSession) {
  if (!session.refresh_token) {
    clearBrowserAuthSession(config.sessionKey);
    return null;
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });

    const body = await safeReadJson(response);
    if (!isCurrentSession(config.sessionKey, session)) return null;
    if (!response.ok) {
      clearBrowserAuthSession(config.sessionKey);
      return null;
    }

    const refreshedSession = normalizeAuthSessionBody(body);
    if (!refreshedSession) {
      clearBrowserAuthSession(config.sessionKey);
      return null;
    }

    saveBrowserAuthSession(config.sessionKey, refreshedSession);
    return refreshedSession.access_token;
  } catch {
    if (isCurrentSession(config.sessionKey, session)) clearBrowserAuthSession(config.sessionKey);
    return null;
  }
}

export async function getValidAccessToken(config: BrowserAuthConfig) {
  try {
    const session = readBrowserAuthSession(config.sessionKey);
    if (!session) return null;

    const expiresAtMs =
      typeof session.expires_at === "number" ? session.expires_at * 1000 : 0;
    if (expiresAtMs && expiresAtMs - Date.now() > tokenRefreshMarginMs) {
      return session.access_token;
    }

    const existingRefresh = refreshLocks.get(config.sessionKey);
    if (existingRefresh) return existingRefresh;

    const refreshPromise = refreshAuthSession(config, session).finally(() => {
      if (refreshLocks.get(config.sessionKey) === refreshPromise) refreshLocks.delete(config.sessionKey);
    });
    refreshLocks.set(config.sessionKey, refreshPromise);
    return refreshPromise;
  } catch {
    clearBrowserAuthSession(config.sessionKey);
    return null;
  }
}

export async function signOutBrowserSession(config: BrowserAuthConfig) {
  const session = readBrowserAuthSession(config.sessionKey);
  clearBrowserAuthSession(config.sessionKey);
  if (!session) return;
  try {
    await fetch(`${config.url}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${session.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* Local invalidation must survive an offline logout. */ }
}

export function clearLegacySupabaseSession() {
  if (typeof window === "undefined") return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return;
  const key = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  for (const suffix of ["", "-user", "-code-verifier"]) {
    window.localStorage.removeItem(key + suffix);
  }
}
