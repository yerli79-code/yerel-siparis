import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// @ts-expect-error Node's type-stripping test runner requires the source extension.
import { loginAdmin, logoutAdmin, readAdminSession, requestAdminApi } from "../admin-client.ts";
// @ts-expect-error Node's type-stripping test runner requires the source extension.
import { isSameOriginAdminRequest } from "./same-origin.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const adminPage = source("app/admin/page.tsx");
const adminClient = source("lib/admin-client.ts");
const supabaseAdminClient = source("lib/supabase-admin.ts");
const adminAuth = source("lib/admin/auth.ts");
const adminSession = source("lib/admin/session.ts");
const adminHttp = source("lib/admin/http.ts");
const adminDal = source("lib/admin/dal.ts");
const loginRoute = source("app/api/admin/auth/login/route.ts");
const refreshRoute = source("app/api/admin/auth/refresh/route.ts");
const logoutRoute = source("app/api/admin/auth/logout/route.ts");

const dataRoutes = [
  "app/api/admin/list-businesses/route.ts",
  "app/api/admin/create-business/route.ts",
  "app/api/admin/update-business/route.ts",
  "app/api/admin/update-subscription/route.ts",
  "app/api/admin/delete-business/route.ts",
].map(source);

const mutationRoutes = [
  loginRoute,
  refreshRoute,
  logoutRoute,
  ...dataRoutes.slice(1),
];

async function withMockFetch<T>(
  mock: typeof fetch,
  operation: () => Promise<T>,
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("admin API request uses same-origin cookies without an authorization header", async () => {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const response = await withMockFetch(
    (async (input, init) => {
      calls.push({ input, init });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
    () => requestAdminApi("/api/admin/list-businesses"),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.credentials, "same-origin");
  assert.equal(new Headers(calls[0].init?.headers).has("authorization"), false);
});

test("expired access performs one server refresh and retries", async () => {
  const calls: string[] = [];
  const response = await withMockFetch(
    (async (input) => {
      calls.push(String(input));
      if (calls.length === 1) return new Response(null, { status: 401 });
      if (String(input) === "/api/admin/auth/refresh") {
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
    () => requestAdminApi("/api/admin/list-businesses"),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    "/api/admin/list-businesses",
    "/api/admin/auth/refresh",
    "/api/admin/list-businesses",
  ]);
});

test("invalid refresh leaves the protected request unauthorized", async () => {
  const calls: string[] = [];
  const response = await withMockFetch(
    (async (input) => {
      calls.push(String(input));
      return new Response(null, { status: 401 });
    }) as typeof fetch,
    () => requestAdminApi("/api/admin/list-businesses"),
  );

  assert.equal(response.status, 401);
  assert.deepEqual(calls, [
    "/api/admin/list-businesses",
    "/api/admin/auth/refresh",
  ]);
});

test("login sends credentials only to the local server endpoint", async () => {
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  const authenticated = await withMockFetch(
    (async (input, init) => {
      captured = { input, init };
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
    () => loginAdmin("admin@example.com", "not-a-real-password"),
  );

  assert.equal(authenticated, true);
  assert.equal(captured.input, "/api/admin/auth/login");
  assert.equal(captured.init?.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(captured.init?.body)), {
    email: "admin@example.com",
    password: "not-a-real-password",
  });
});

test("failed server login does not authenticate the browser", async () => {
  const authenticated = await withMockFetch(
    (async () => new Response("{}", { status: 401 })) as typeof fetch,
    () => loginAdmin("user@example.com", "wrong"),
  );
  assert.equal(authenticated, false);
});

test("session status accepts only the minimum session DTO", async () => {
  const session = await withMockFetch(
    (async () =>
      Response.json({ authenticated: true, userId: "user-1" })) as typeof fetch,
    () => readAdminSession(),
  );
  assert.deepEqual(session, { authenticated: true, userId: "user-1" });
});

test("session status rejects malformed or token-shaped responses", async () => {
  const session = await withMockFetch(
    (async () =>
      Response.json({ access_token: "secret", refresh_token: "secret" })) as typeof fetch,
    () => readAdminSession(),
  );
  assert.equal(session, null);
});

test("logout always calls the local server endpoint", async () => {
  const calls: string[] = [];
  await withMockFetch(
    (async (input) => {
      calls.push(String(input));
      return new Response(null, { status: 503 });
    }) as typeof fetch,
    () => logoutAdmin(),
  );
  assert.deepEqual(calls, ["/api/admin/auth/logout"]);
});

test("logout tolerates a network failure", async () => {
  await assert.doesNotReject(() =>
    withMockFetch(
      (async () => {
        throw new Error("offline");
      }) as typeof fetch,
      () => logoutAdmin(),
    ),
  );
});

test("admin client code has no JS-readable auth token storage or bearer transport", () => {
  const clientSource = `${adminPage}\n${adminClient}\n${supabaseAdminClient}`;
  assert.doesNotMatch(clientSource, /\bsessionStorage\b/);
  assert.doesNotMatch(clientSource, /\baccess_token\b/);
  assert.doesNotMatch(clientSource, /\brefresh_token\b/);
  assert.doesNotMatch(clientSource, /Authorization\s*:/i);
  assert.doesNotMatch(clientSource, /Bearer\s+/i);
  assert.doesNotMatch(clientSource, /\/auth\/v1\/token/);
});

test("login response cannot serialize provider tokens or a raw user", () => {
  assert.doesNotMatch(loginRoute, /access_token|refresh_token|service_role/i);
  assert.match(loginRoute, /authenticated:\s*true,\s*userId:/);
  assert.doesNotMatch(loginRoute, /\buser\s*:/);
});

test("login validates required credentials as a controlled 400", () => {
  assert.match(loginRoute, /INVALID_REQUEST/);
  assert.match(loginRoute, /Geçerli e-posta ve şifre zorunludur/);
  assert.match(loginRoute, /400/);
});

test("bad provider credentials become a controlled 401", () => {
  assert.match(adminAuth, /response\.status === 400 \|\| response\.status === 401/);
  assert.match(adminAuth, /"UNAUTHORIZED"/);
  assert.match(adminAuth, /401/);
});

test("a verified non-admin is forbidden before cookies are written", () => {
  const loginFunction = adminAuth.slice(adminAuth.indexOf("export async function loginAdmin"));
  assert.ok(loginFunction.indexOf("verifyTokens(tokens)") < loginFunction.indexOf("writeAdminSessionCookies(tokens)"));
  assert.match(adminAuth, /"FORBIDDEN"/);
  assert.match(adminAuth, /isActiveAdminEmail/);
});

test("active admin lookup uses normalized verified email and is_active", () => {
  assert.match(adminDal, /email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(adminDal, /email=eq/);
  assert.match(adminDal, /is_active=eq\.true/);
  assert.match(adminDal, /select=id&limit=1/);
});

test("admin cookies are HttpOnly, scoped, SameSite and production-secure", () => {
  assert.match(adminSession, /httpOnly:\s*true/);
  assert.match(adminSession, /secure:\s*process\.env\.NODE_ENV === "production"/);
  assert.match(adminSession, /sameSite:\s*"lax"/);
  assert.match(adminSession, /path:\s*"\/"/);
  assert.doesNotMatch(adminSession, /domain:/);
});

test("access expiry follows provider expiry and refresh has a longer max-age", () => {
  assert.match(adminSession, /tokens\?\.expiresAt/);
  assert.match(adminSession, /tokens\?\.expiresIn/);
  assert.match(adminSession, /60 \* 60 \* 24 \* 30/);
  assert.match(adminSession, /maxAge/);
});

test("refresh rotates both cookies and clears them on every failure", () => {
  assert.match(adminAuth, /exchangeRefreshToken\(refreshToken\)/);
  assert.match(adminAuth, /writeAdminSessionCookies\(tokens\)/);
  assert.match(adminAuth, /catch \(error\)[\s\S]*clearAdminSessionCookies\(\)/);
  assert.match(refreshRoute, /refreshAdminSession/);
});

test("logout attempts provider revocation but cookie cleanup is unconditional", () => {
  assert.match(adminAuth, /\/auth\/v1\/logout/);
  assert.match(adminAuth, /finally[\s\S]*clearAdminSessionCookies\(\)/);
  assert.match(logoutRoute, /logoutAdminSession/);
});

test("requireAdmin has one cookie, identity and active allowlist gate", () => {
  const gate = adminAuth.slice(adminAuth.indexOf("export async function requireAdmin"));
  assert.match(gate, /readAdminSessionCookies/);
  assert.match(gate, /getVerifiedSupabaseIdentity/);
  assert.match(gate, /assertActiveAdmin/);
  assert.match(gate, /"UNAUTHORIZED"/);
});

test("every existing admin data route uses centralized requireAdmin", () => {
  for (const route of dataRoutes) {
    assert.match(route, /requireAdmin\(\)/);
    assert.doesNotMatch(route, /getAdminToken|verifyAdminAccess/);
    assert.doesNotMatch(route, /headers\.get\("authorization"\)/i);
  }
});

test("every admin mutation rejects requests without exact dynamic origin", () => {
  for (const route of mutationRoutes) {
    assert.match(route, /assertSameOriginAdminMutation\(request\)/);
  }
  assert.match(adminHttp, /isSameOriginAdminRequest\(request\)/);
  assert.doesNotMatch(adminHttp, /yerelsiparis\.com/i);
});

test("same-origin mutation is accepted", () => {
  const request = new Request("https://preview.example.dev/api/admin/update-business", {
    method: "POST",
    headers: { Origin: "https://preview.example.dev" },
  });
  assert.equal(isSameOriginAdminRequest(request), true);
});

test("cross-origin and missing-origin mutations are rejected", () => {
  const malicious = new Request("https://preview.example.dev/api/admin/delete-business", {
    method: "POST",
    headers: { Origin: "https://attacker.example" },
  });
  const missing = new Request("https://preview.example.dev/api/admin/delete-business", {
    method: "POST",
  });
  assert.equal(isSameOriginAdminRequest(malicious), false);
  assert.equal(isSameOriginAdminRequest(missing), false);
});

test("same-origin check derives preview origin from the request URL", () => {
  for (const origin of [
    "https://feature-one.vercel.app",
    "https://feature-two.vercel.app",
  ]) {
    const request = new Request(`${origin}/api/admin/auth/refresh`, {
      method: "POST",
      headers: { Origin: origin },
    });
    assert.equal(isSameOriginAdminRequest(request), true);
  }
});

test("admin responses are private no-store and vary only by Cookie", () => {
  assert.match(adminHttp, /private, no-store, max-age=0/);
  assert.match(adminHttp, /Vary:\s*"Cookie"/);
  assert.doesNotMatch(adminHttp, /Vary:\s*"Authorization"/);
});

test("controlled error contract contains every required security code", () => {
  const errors = source("lib/admin/errors.ts");
  for (const code of [
    "UNAUTHORIZED",
    "FORBIDDEN",
    "INVALID_REQUEST",
    "SESSION_EXPIRED",
    "CSRF_REJECTED",
    "ADMIN_UNAVAILABLE",
  ]) {
    assert.match(errors, new RegExp(`"${code}"`));
  }
  assert.match(adminHttp, /error:\s*\{[\s\S]*code:[\s\S]*message:/);
});

test("service role stays outside the admin client import graph", () => {
  const clientSource = `${adminPage}\n${adminClient}\n${supabaseAdminClient}`;
  assert.doesNotMatch(clientSource, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/);
  assert.match(source("lib/admin/config.ts"), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source("lib/admin/config.ts"), /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
});

test("auth implementation does not log credentials, tokens or cookies", () => {
  const authSource = `${adminAuth}\n${adminSession}\n${loginRoute}\n${refreshRoute}\n${logoutRoute}`;
  assert.doesNotMatch(authSource, /console\.(log|error|warn)/);
  assert.doesNotMatch(authSource, /cookie header/i);
});

test("the P5.0A RPC remains unused by the admin browser", () => {
  assert.doesNotMatch(adminPage, /admin_list_businesses/i);
  assert.doesNotMatch(supabaseAdminClient, /admin_list_businesses/i);
});
