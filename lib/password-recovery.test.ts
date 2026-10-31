import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { createBrowserSupabaseClient } from "./supabase-client";
import { createPasswordRecovery, parseRecoveryLink } from "./password-recovery";
import {
  authGenerationKey, businessSessionKey, clearBrowserAuthSession,
  clearLegacySupabaseSession, getValidAccessToken, readBrowserAuthSession,
  saveBrowserAuthSession, signInWithPassword, signOutBrowserSession,
} from "./browser-auth-session";

// Real Supabase SDK + an in-process Auth transport. No native fetch fallback,
// env-file loading, external network, real email, database or account creation.
const origin = "http://127.0.0.1:47123";
const config = { url: origin, publishableKey: "sb_publishable_recovery_test_only", sessionKey: businessSessionKey };
const ownerA = "00000000-0000-4000-8000-000000000001";
const ownerB = "00000000-0000-4000-8000-000000000002";
const password = "Synthetic!Password42";
function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const previousFetch = globalThis.fetch;
const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const previousEnv = names.map(name => process.env[name]);
let local: ReturnType<typeof storage>;
let tab: ReturnType<typeof storage>;
let clients: ReturnType<typeof createBrowserSupabaseClient>[];
let calls: Array<{ path: string; method: string; body: Record<string, string>; user?: string }>;
let sessions: Map<string, ReturnType<typeof session>>;
let refreshes: Map<string, ReturnType<typeof session>>;
let updateUsers: string[];
let codeUsed: boolean;
let adminPresent: boolean;
let expiresIn: number;
let pkceChallenge: string;

function session(id = ownerB, duration = 3600, method = "otp") {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: id, exp: Math.floor(Date.now() / 1000) + duration, amr: [{ method }], nonce: crypto.randomUUID() })}.${encode("synthetic-signature")}`;
  return { access_token: token, refresh_token: crypto.randomUUID(), token_type: "bearer",
    expires_in: duration, expires_at: Math.floor(Date.now() / 1000) + duration,
    user: { id, aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid",
      app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } };
}
function remember(value: ReturnType<typeof session>) {
  sessions.set(value.access_token, value); refreshes.set(value.refresh_token, value); return value;
}
function client() { const value = createBrowserSupabaseClient(); clients.push(value); return value; }
async function cleanup() {
  clearBrowserAuthSession(businessSessionKey);
  clearLegacySupabaseSession();
  adminPresent = false; // Browser-only cookie clearing, tested separately at the route boundary.
}
function recovery(value = client()) {
  return createPasswordRecovery(value.auth, cleanup, () => value.discardRecoverySession());
}
async function requestLink() {
  const requester = client();
  assert.equal((await requester.auth.resetPasswordForEmail("synthetic@example.invalid", {
    redirectTo: "http://127.0.0.1:3100/sifre-yenile",
  })).error, null);
  return "http://127.0.0.1:3100/sifre-yenile?code=synthetic-valid";
}
beforeEach(() => {
  local = storage(); tab = storage(); clients = []; calls = []; sessions = new Map(); refreshes = new Map();
  updateUsers = []; codeUsed = false; adminPresent = true; expiresIn = 3600; pkceChallenge = "";
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: local, sessionStorage: tab } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = config.publishableKey;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, origin, "Auth test transport must fail closed off loopback");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const token = new Headers(init.headers).get("Authorization")?.replace(/^Bearer /, "") ?? "";
    const active = sessions.get(token);
    calls.push({ path: url.pathname, method, body, user: active?.user.id });
    const denied = () => Response.json({ msg: "Invalid synthetic credential", error_code: "otp_expired" }, { status: 400 });
    if (url.pathname === "/auth/v1/recover") {
      assert.ok(body.code_challenge, "New requests must use PKCE");
      pkceChallenge = body.code_challenge;
      return Response.json({});
    }
    if (url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "pkce") {
        if (body.auth_code !== "synthetic-valid" || !body.code_verifier || codeUsed ||
            createHash("sha256").update(body.code_verifier).digest("base64url") !== pkceChallenge) return denied();
        codeUsed = true;
        return Response.json(remember(session(ownerB, expiresIn)));
      }
      if (grant === "refresh_token") {
        const old = refreshes.get(body.refresh_token);
        if (!old) return denied();
        refreshes.delete(body.refresh_token);
        return Response.json(remember(session(old.user.id)));
      }
      if (grant === "password") return body.password === password
        ? Response.json(remember(session(body.email === "a@example.invalid" ? ownerA : ownerB))) : denied();
    }
    if (url.pathname === "/auth/v1/user") {
      if (!active || active.expires_at * 1000 <= Date.now()) return denied();
      if (method === "PUT") { assert.equal(body.password, password); updateUsers.push(active.user.id); }
      return Response.json(active.user);
    }
    if (url.pathname === "/auth/v1/logout") {
      for (const [key, value] of refreshes) if (value.user.id === active?.user.id) refreshes.delete(key);
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected synthetic Auth operation");
  };
});
afterEach(async () => {
  for (const value of clients) value.discardRecoverySession();
  globalThis.fetch = previousFetch;
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
  names.forEach((name, i) => { if (previousEnv[i] === undefined) delete process.env[name]; else process.env[name] = previousEnv[i]; });
});

test("valid PKCE recovery, Strict Mode replay, password update, cleanup and fresh login", async () => {
  const href = await requestLink();
  saveBrowserAuthSession(businessSessionKey, session(ownerA));
  local.setItem("sb-127-auth-token", JSON.stringify(session(ownerA)));
  const flow = recovery();
  assert.deepEqual(await Promise.all([flow.open(href), flow.open(href)]), [true, true]);
  assert.equal(calls.filter(c => c.body.auth_code).length, 1);
  assert.equal(adminPresent, false);
  await flow.update(password);
  assert.deepEqual(updateUsers, [ownerB]);
  assert.equal(readBrowserAuthSession(businessSessionKey), null);
  assert.equal(local.getItem("sb-127-auth-token"), null);
  assert.ok(![...local.data.values()].some(value => value.includes("access_token")));
  await assert.rejects(flow.update(password));
  assert.equal((await signInWithPassword(config, "b@example.invalid", password))?.user?.id, ownerB);
  assert.ok(await getValidAccessToken(config));
});

for (const suffix of ["?type=recovery", "?code=invalid", "?code=expired", "#error_code=otp_expired", "?code=x&code=y", "#access_token=x&type=recovery"]) {
  test(`invalid or expired recovery is rejected (${suffix.split(/[=#]/)[0]})`, async () => {
    saveBrowserAuthSession(businessSessionKey, session(ownerA));
    const flow = recovery();
    await assert.rejects(flow.open(`http://127.0.0.1:3100/sifre-yenile${suffix}`));
    await assert.rejects(flow.update(password));
    assert.deepEqual(updateUsers, []);
  });
}
test("a consumed recovery code cannot authorize a second page", async () => {
  const href = await requestLink();
  await recovery().open(href);
  await assert.rejects(recovery().open(href));
  assert.deepEqual(updateUsers, []);
});
test("a successful non-recovery code exchange cannot authorize password update", async () => {
  local.setItem("yerel-siparis-recovery-code-verifier", JSON.stringify("synthetic-verifier"));
  pkceChallenge = createHash("sha256").update("synthetic-verifier").digest("base64url");
  const flow = recovery();
  await assert.rejects(flow.open("http://127.0.0.1:3100/sifre-yenile?code=synthetic-valid"));
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
});
test("network failure during code exchange fails closed", async () => {
  const href = await requestLink();
  const value = client();
  value.auth.exchangeCodeForSession = async () => { throw new Error("Synthetic offline failure"); };
  const flow = recovery(value);
  await assert.rejects(flow.open(href));
  await assert.rejects(flow.update(password));
});
test("an expired exchanged session is rejected before showing an authorized form", async () => {
  const href = await requestLink(); expiresIn = -10;
  const flow = recovery();
  await assert.rejects(flow.open(href));
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
});
test("an existing SDK or panel session without recovery cannot change a password", async () => {
  const old = remember(session(ownerA));
  const value = client();
  assert.equal((await value.auth.setSession(old)).error, null);
  saveBrowserAuthSession(businessSessionKey, old);
  const flow = recovery(value);
  assert.equal(await flow.open("http://127.0.0.1:3100/sifre-yenile"), false);
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
});
test("legacy implicit links fail closed and require a new PKCE request", async () => {
  const target = remember(session(ownerB));
  saveBrowserAuthSession(businessSessionKey, session(ownerA));
  const flow = recovery();
  const href = `http://127.0.0.1:3100/sifre-yenile#type=recovery&access_token=${target.access_token}&refresh_token=${target.refresh_token}`;
  await assert.rejects(flow.open(href));
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
  assert.equal(calls.some(call => call.body.refresh_token), false);
});
test("mixed-account legacy access/refresh pair is rejected", async () => {
  const a = remember(session(ownerA)), b = remember(session(ownerB));
  const flow = recovery();
  await assert.rejects(flow.open(`http://127.0.0.1:3100/sifre-yenile#type=recovery&access_token=${a.access_token}&refresh_token=${b.refresh_token}`));
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
});
test("a normal password session cannot become recovery by changing the URL type", async () => {
  const ordinary = remember(session(ownerB, 3600, "password"));
  const flow = recovery();
  await assert.rejects(flow.open(`http://127.0.0.1:3100/sifre-yenile#type=recovery&access_token=${ordinary.access_token}&refresh_token=${ordinary.refresh_token}`));
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
  assert.equal(calls.some(call => call.body.refresh_token), false);
});
test("account replacement after validation blocks update", async () => {
  const href = await requestLink(), value = client(), flow = recovery(value);
  await flow.open(href);
  const replaced = await value.auth.setSession(remember(session(ownerA)));
  assert.equal(replaced.error, null);
  assert.equal(replaced.data.session?.user.id, ownerA);
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
});
test("failed remote logout still discards recovery and panel credentials", async () => {
  const href = await requestLink(), value = client(), flow = recovery(value);
  await flow.open(href);
  value.auth.signOut = async () => ({ error: new Error("Synthetic logout failure") } as Awaited<ReturnType<typeof value.auth.signOut>>);
  await assert.rejects(flow.update(password));
  assert.equal((await value.auth.getSession()).data.session, null);
  assert.equal(readBrowserAuthSession(businessSessionKey), null);
  await assert.rejects(flow.update(password));
});
test("late business refresh cannot restore an old account after login switches", async () => {
  saveBrowserAuthSession(businessSessionKey, { ...session(ownerA), expires_at: 1 });
  let finish!: (value: Response) => void;
  const normalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("grant_type=refresh_token")
    ? new Promise<Response>(resolve => { finish = resolve; }) : normalFetch(input, init);
  const pending = getValidAccessToken(config);
  assert.equal((await signInWithPassword(config, "b@example.invalid", password))?.user?.id, ownerB);
  finish(Response.json(session(ownerA)));
  assert.equal(await pending, null);
  assert.equal(readBrowserAuthSession(businessSessionKey)?.user?.id, ownerB);
});
test("cross-tab invalidation and offline business logout require fresh login", async () => {
  saveBrowserAuthSession(businessSessionKey, session(ownerA));
  local.setItem(authGenerationKey(businessSessionKey), crypto.randomUUID());
  assert.equal(await getValidAccessToken(config), null);
  await signInWithPassword(config, "b@example.invalid", password);
  globalThis.fetch = async () => { throw new Error("Synthetic offline failure"); };
  await signOutBrowserSession(config);
  assert.equal(await getValidAccessToken(config), null);
});
test("ordinary URL is a request page; ambiguous and non-recovery links fail closed", () => {
  assert.equal(parseRecoveryLink("http://127.0.0.1:3100/sifre-yenile").kind, "none");
  assert.equal(parseRecoveryLink("http://127.0.0.1:3100/sifre-yenile?code=x&type=signup").kind, "invalid");
});

test("session expiry after opening prevents the password write", async () => {
  const href = await requestLink(), value = client(), flow = recovery(value);
  await flow.open(href);
  sessions.clear();
  await assert.rejects(flow.update(password));
  assert.deepEqual(updateUsers, []);
  assert.equal((await value.auth.getSession()).data.session, null);
});
test("cancelled page cannot grant a capability after its verification finishes", async () => {
  const href = await requestLink(), value = client(), flow = recovery(value);
  const pending = flow.open(href);
  flow.cancel();
  await assert.rejects(pending);
  await assert.rejects(flow.update(password));
  assert.equal((await value.auth.getSession()).data.session, null);
  assert.deepEqual(updateUsers, []);
});
test("failed password update consumes the capability and clears credentials", async () => {
  const href = await requestLink(), value = client(), flow = recovery(value);
  await flow.open(href);
  value.auth.updateUser = async () => ({ data: { user: null }, error: new Error("Synthetic rejection") } as Awaited<ReturnType<typeof value.auth.updateUser>>);
  await assert.rejects(flow.update(password));
  await assert.rejects(flow.update(password));
  assert.equal((await value.auth.getSession()).data.session, null);
  assert.equal(readBrowserAuthSession(businessSessionKey), null);
});
test("logout racing a pending refresh cannot restore the logged-out account", async () => {
  saveBrowserAuthSession(businessSessionKey, { ...session(ownerA), expires_at: 1 });
  let finish!: (value: Response) => void;
  const normalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("grant_type=refresh_token")
    ? new Promise<Response>(resolve => { finish = resolve; }) : normalFetch(input, init);
  const pending = getValidAccessToken(config);
  await signOutBrowserSession(config);
  finish(Response.json(session(ownerA)));
  assert.equal(await pending, null);
  assert.equal(readBrowserAuthSession(businessSessionKey), null);
});
