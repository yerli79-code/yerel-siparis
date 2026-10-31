import type { Session, SupabaseClient } from "@supabase/supabase-js";

export const invalidRecoveryMessage =
  "Şifre yenileme bağlantısı geçersiz, kullanılmış veya süresi dolmuş. Yeni bağlantı isteyin.";

type RecoveryLink =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "code"; code: string };

export function parseRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.slice(1));
  const keys = ["code", "type", "access_token", "refresh_token", "error", "error_code", "error_description"];
  if (!keys.some(key => query.has(key) || hash.has(key))) return { kind: "none" };
  for (const params of [query, hash]) {
    if (keys.some(key => params.getAll(key).length > 1) ||
        ["error", "error_code", "error_description"].some(key => params.has(key))) return { kind: "invalid" };
  }
  if (query.get("code")?.trim() && !hash.toString() &&
      (!query.has("type") || query.get("type") === "recovery") &&
      !query.has("access_token") && !query.has("refresh_token")) {
    return { kind: "code", code: query.get("code")! };
  }
  // Legacy implicit tokens carry no server-verifiable distinction between
  // password recovery and other email OTP logins. Require a new PKCE request.
  return { kind: "invalid" };
}

export function validateRecoveryPassword(password: string) {
  if (password.length < 10) return "Şifre en az 10 karakter olmalıdır.";
  if (!/[A-ZÇĞİÖŞÜ]/.test(password)) return "Şifre en az 1 büyük harf içermelidir.";
  if (!/[a-zçğıöşü]/.test(password)) return "Şifre en az 1 küçük harf içermelidir.";
  if (!/[0-9]/.test(password)) return "Şifre en az 1 rakam içermelidir.";
  if (!/[^A-Za-zÇĞİÖŞÜçğıöşü0-9]/.test(password)) return "Şifre en az 1 özel karakter içermelidir.";
  return "";
}

// A capability exists only after this page exchanges/verifies its own link.
// No persisted session, URL flag or INITIAL_SESSION event can create it.
export function createPasswordRecovery(
  auth: SupabaseClient["auth"],
  clearOtherSessions: () => Promise<void>,
  discardSession: () => void,
) {
  let context: Session | null = null;
  let opening: Promise<boolean> | null = null;
  let consumed = false;
  let cancelled = false;

  async function verify(session: Session) {
    if (!session.expires_at || session.expires_at * 1000 <= Date.now()) throw new Error(invalidRecoveryMessage);
    const { data, error } = await auth.getUser(session.access_token);
    if (error || !data.user || data.user.id !== session.user.id) throw new Error(invalidRecoveryMessage);
  }

  return {
    open(href: string) {
      // React Strict Mode must not exchange a single-use code twice.
      if (opening) return opening;
      opening = (async () => {
        const link = parseRecoveryLink(href);
        if (link.kind === "none") return false;
        if (link.kind === "invalid") throw new Error(invalidRecoveryMessage);
        await clearOtherSessions();
        let session: Session | null = null;
        if (link.kind === "code") {
          let recoveryEvent = false;
          const { data: listener } = auth.onAuthStateChange(event => {
            if (event === "PASSWORD_RECOVERY") recoveryEvent = true;
          });
          try {
            const { data, error } = await auth.exchangeCodeForSession(link.code);
            if (error || !data.session || !recoveryEvent) throw new Error(invalidRecoveryMessage);
            session = data.session;
          } finally { listener.subscription.unsubscribe(); }
        }
        if (!session) throw new Error(invalidRecoveryMessage);
        await verify(session);
        if (cancelled) throw new Error(invalidRecoveryMessage);
        context = session;
        return true;
      })().catch(async () => {
        context = null;
        discardSession();
        throw new Error(invalidRecoveryMessage);
      });
      return opening;
    },
    async update(password: string) {
      if (!context || consumed || cancelled) throw new Error(invalidRecoveryMessage);
      const passwordError = validateRecoveryPassword(password);
      if (passwordError) throw new Error(passwordError);
      consumed = true;
      const session = context;
      context = null;
      let ownsSession = false;
      try {
        await verify(session);
        const current = await auth.getSession();
        if (current.error || current.data.session?.access_token !== session.access_token ||
            current.data.session.user.id !== session.user.id) throw new Error(invalidRecoveryMessage);
        ownsSession = true;
        const { data, error } = await auth.updateUser({ password });
        if (error || data.user?.id !== session.user.id) throw new Error("Şifre güncellenemedi. Yeni bağlantı isteyin.");
      } finally {
        const result = ownsSession
          ? await auth.signOut({ scope: "global" }).catch(() => ({ error: true }))
          : { error: null };
        discardSession();
        await clearOtherSessions();
        if (result.error) throw new Error("Oturum iptali doğrulanamadı. Yeni bağlantı isteyin.");
      }
    },
    cancel() {
      cancelled = true;
      context = null;
      discardSession();
    },
  };
}
