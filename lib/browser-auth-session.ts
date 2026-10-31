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
// A failed storage operation cannot fall back to an apparently valid local
// generation. Only a fresh login that publishes a new generation can recover.
const blockedSessions = new Set<string>();
export const businessSessionKey = "yerel-siparis-business-session";
export const authGenerationKey = (sessionKey: string) => `${sessionKey}-generation`;

function generation(sessionKey: string) {
  if (typeof window === "undefined" || blockedSessions.has(sessionKey)) return null;
  try {
    return window.localStorage.getItem(authGenerationKey(sessionKey)) ?? "";
  } catch {
    blockedSessions.add(sessionKey);
    return null;
  }
}

function discardLocalSession(sessionKey: string) {
  try { window.sessionStorage.removeItem(sessionKey); }
  catch { blockedSessions.add(sessionKey); }
}

function currentSession(sessionKey: string, session: BrowserAuthSession) {
  const current = readBrowserAuthSession(sessionKey);
  return current?.access_token === session.access_token &&
    current.refresh_token === session.refresh_token &&
    current.generation === session.generation && generation(sessionKey) === session.generation
    ? current : null;
}

function isCurrentSession(sessionKey: string, session: BrowserAuthSession) {
  return currentSession(sessionKey, session) !== null;
}

function discardFailedSession(sessionKey: string, session: BrowserAuthSession) {
  // Async failure is not a new logout intent. Publishing a shared generation
  // here could invalidate a newer account in another tab after our last check.
  if (isCurrentSession(sessionKey, session)) discardLocalSession(sessionKey);
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

  try {
    const stored = window.sessionStorage.getItem(sessionKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<BrowserAuthSession>;
    const session = normalizeAuthSessionBody(parsed, false);
    if (!session) {
      discardLocalSession(sessionKey);
      return null;
    }
    const currentGeneration = generation(sessionKey);
    if (currentGeneration === null || (session.generation ?? "") !== currentGeneration) {
      discardLocalSession(sessionKey);
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
    blockedSessions.add(sessionKey);
    discardLocalSession(sessionKey);
    return null;
  }
}

export function saveBrowserAuthSession(
  sessionKey: string,
  session: BrowserAuthSession,
  expectedGeneration = session.generation ?? generation(sessionKey),
) {
  if (typeof window === "undefined" || expectedGeneration === null ||
      generation(sessionKey) !== expectedGeneration) return null;
  const candidate = { ...session, generation: expectedGeneration };
  try {
    // Another tab may invalidate between this check and setItem. Preserve the
    // captured generation: an old write must remain old on every later read.
    window.sessionStorage.setItem(sessionKey, JSON.stringify(candidate));
    return currentSession(sessionKey, candidate);
  } catch {
    blockedSessions.add(sessionKey);
    discardLocalSession(sessionKey);
    return null;
  }
}

export function clearBrowserAuthSession(sessionKey: string) {
  if (typeof window === "undefined") return null;
  refreshLocks.delete(sessionKey);
  blockedSessions.add(sessionKey);
  try {
    const next = crypto.randomUUID();
    window.localStorage.setItem(authGenerationKey(sessionKey), next);
    window.sessionStorage.removeItem(sessionKey);
    if (window.localStorage.getItem(authGenerationKey(sessionKey)) !== next) return null;
    blockedSessions.delete(sessionKey);
    return next;
  } catch {
    discardLocalSession(sessionKey);
    return null;
  }
}

export async function signInWithPassword(
  config: BrowserAuthConfig,
  email: string,
  password: string,
) {
  const startedGeneration = clearBrowserAuthSession(config.sessionKey);
  if (startedGeneration === null) return null;
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

  const saved = await saveBrowserAuthSession(config.sessionKey, session, startedGeneration);
  // Revalidate the async result handoff as well as the storage write.
  return saved ? currentSession(config.sessionKey, saved) : null;
}

async function refreshAuthSession(config: BrowserAuthConfig, session: BrowserAuthSession) {
  if (!session.refresh_token) {
    discardFailedSession(config.sessionKey, session);
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
      discardFailedSession(config.sessionKey, session);
      return null;
    }

    const refreshedSession = normalizeAuthSessionBody(body);
    if (!refreshedSession) {
      discardFailedSession(config.sessionKey, session);
      return null;
    }

    const saved = saveBrowserAuthSession(config.sessionKey, refreshedSession, session.generation ?? "");
    return saved?.access_token ?? null;
  } catch {
    discardFailedSession(config.sessionKey, session);
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
      return isCurrentSession(config.sessionKey, session) ? session.access_token : null;
    }

    const existingRefresh = refreshLocks.get(config.sessionKey);
    if (existingRefresh) {
      const token = await existingRefresh;
      const current = readBrowserAuthSession(config.sessionKey);
      return token && current && current.generation === session.generation && current.access_token === token &&
        isCurrentSession(config.sessionKey, current) ? token : null;
    }

    const refreshPromise = refreshAuthSession(config, session).finally(() => {
      if (refreshLocks.get(config.sessionKey) === refreshPromise) refreshLocks.delete(config.sessionKey);
    });
    refreshLocks.set(config.sessionKey, refreshPromise);
    const token = await refreshPromise;
    const current = readBrowserAuthSession(config.sessionKey);
    return token && current && current.generation === session.generation && current.access_token === token &&
      isCurrentSession(config.sessionKey, current) ? token : null;
  } catch {
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
