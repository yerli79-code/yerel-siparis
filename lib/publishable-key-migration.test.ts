import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, after } from "node:test";
import ts from "typescript";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { isSupabasePublishableKey } from "./supabase-publishable-key.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { getPublicBusinessBySlug, getPublicBusinessSlugs } from "./public-business-server.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { fetchPublicActiveBusinesses, fetchPublicBusinessBySlug, fetchPublicProductsByBusinessId, fetchPublicProductsByBusinessSlug, getCurrentSupabaseUser, getBusinessByOwnerId, uploadProductImage, uploadBusinessImage } from "./supabase-business.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { getSupabaseServerConfig as orderConfig, getUserFromToken as orderUser } from "../app/api/business/orders/_utils.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { getSupabaseServerConfig as productConfig, getUserFromToken as productUser } from "../app/api/business/products/_utils.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { getSupabasePublicServerConfig as adminConfig } from "./admin/config.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { getVerifiedSupabaseIdentity } from "./admin/dal.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { signInWithPassword, getValidAccessToken } from "./browser-auth-session.ts";

const key = "sb_publishable_test_key";
const userToken = "USER_TOKEN";
const url = "https://supabase.example.test";
const root = new URL("../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const envNames = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVER_SECRET_KEY"];
// This runner does not load .env files. Only synthetic configuration is used.
const priorEnv = envNames.map((name) => process.env[name]);
process.env.NEXT_PUBLIC_SUPABASE_URL = url;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
process.env.SUPABASE_SERVER_SECRET_KEY = "server-test-key";
after(() => envNames.forEach((name, index) => {
  if (priorEnv[index] === undefined) delete process.env[name];
  else process.env[name] = priorEnv[index];
}));

// Execute an unexported function's actual source, without rendering a page or
// exporting implementation details from production modules just for tests.
function privateFunction(path: string, name: string, dependencies: Record<string, unknown> = {}) {
  const file = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${name} exists in ${path}`);
  const javascript = ts.transpileModule(declaration.getText(file), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("exports", ...Object.keys(dependencies), `${javascript}; return ${name};`)({}, ...Object.values(dependencies));
}

type Call = { url: string; init: RequestInit };
async function capture(run: () => Promise<unknown>, reply: (call: Call) => Response = () => Response.json([])) {
  const previous = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return reply(call);
  };
  try { await run(); } finally { globalThis.fetch = previous; }
  return calls;
}

function assertHeaders(call: Call, token?: string) {
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("apikey"), key);
  assert.equal(headers.has("Authorization"), Boolean(token));
  if (token) assert.equal(headers.get("Authorization"), `Bearer ${token}`);
}

test("public SSR business lookup sends only the publishable API key", async () => {
  const calls = await capture(() => getPublicBusinessBySlug("test-shop"));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/businesses/);
  assertHeaders(calls[0]);
});

test("sitemap slug lookup sends no Authorization header", async () => {
  const calls = await capture(async () => {
    assert.deepEqual(await getPublicBusinessSlugs(), ["test-shop"]);
  }, () => Response.json([{ slug: "test-shop" }]));
  assert.equal(calls.length, 1);
  assertHeaders(calls[0]);
  assert.match(source("app/sitemap.ts"), /getPublicBusinessSlugs/);
});

for (const [label, run] of [
  ["active businesses", () => fetchPublicActiveBusinesses()],
  ["business slug", () => fetchPublicBusinessBySlug("test-shop")],
  ["products by id", () => fetchPublicProductsByBusinessId("business-1")],
  ["products by slug", () => fetchPublicProductsByBusinessSlug("test-shop")],
  ["optional empty user token", () => getBusinessByOwnerId("user-1", "")],
] as const) {
  test(`browser public ${label}: API key without Authorization`, async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
    try {
      const calls = await capture(run, (call) => call.url.includes("select=id&") ? Response.json([{ id: "business-1" }]) : Response.json([]));
      assert.ok(calls.length > 0);
      for (const call of calls) assertHeaders(call);
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });
}

test("browser user lookup and owner query preserve USER_TOKEN Bearer", async () => {
  const calls = await capture(async () => {
    await getCurrentSupabaseUser(userToken);
    await getBusinessByOwnerId("user-1", userToken);
  }, (call) => Response.json(call.url.includes("/auth/v1/user") ? { id: "user-1" } : []));
  assert.equal(calls.length, 2);
  calls.forEach((call) => assertHeaders(call, userToken));
});

test("browser Storage uploads preserve user JWT and publishable API key", async () => {
  const file = new File(["fake image"], "test.png", { type: "image/png" });
  const calls = await capture(async () => {
    await uploadProductImage("business-1", file, userToken);
    await uploadBusinessImage("business-1", file, "logo", userToken);
  }, () => Response.json({}));
  assert.equal(calls.length, 2);
  calls.forEach((call) => assertHeaders(call, userToken));
});

const profileUser = privateFunction("app/api/business/update-profile/route.ts", "getUserFromToken", {
  readJson: privateFunction("app/api/business/update-profile/route.ts", "readJson"),
});
for (const [label, run] of [
  ["orders", () => orderUser(url, key, userToken)],
  ["products", () => productUser(url, key, userToken)],
  ["update-profile", () => profileUser(url, key, userToken)],
  ["admin", () => getVerifiedSupabaseIdentity(userToken)],
] as const) {
  test(`${label} server lookup preserves user JWT and publishable API key`, async () => {
    const calls = await capture(run, () => Response.json({ id: "user-1", email: "test@example.test" }));
    assert.equal(calls.length, 1);
    assertHeaders(calls[0], userToken);
    assert.equal(calls[0].url, `${url}/auth/v1/user`);
  });
}

const configReaders: Array<[string, () => unknown]> = [
  ["orders", orderConfig], ["products", productConfig], ["admin", adminConfig],
  ...[
    ["app/giris/page.tsx", "getSupabaseConfig"],
    ["app/panel/page.tsx", "getSupabaseConfig"],
    ["lib/supabase-business.ts", "getSupabaseConfig"],
    ["lib/public-business-server.ts", "getPublicSupabaseConfig"],
    ["app/api/business/update-profile/route.ts", "getSupabaseServerConfig"],
    ["lib/supabase-client.ts", "createBrowserSupabaseClient"],
  ].map(([path, name]): [string, () => unknown] => [path, privateFunction(path, name, {
    isSupabasePublishableKey,
    ServerConfigError: class extends Error { constructor() { super("Configuration unavailable"); } },
    browserClient: null,
    createClient: () => ({ configured: true }),
  })]),
];

for (const [label, read] of configReaders) {
  test(`${label}: missing and wrong key types fail closed without leaking values`, () => {
    const previousFetch = globalThis.fetch;
    const previousLog = console.log;
    const previousWarn = console.warn;
    const previousError = console.error;
    let requests = 0;
    const logs: unknown[][] = [];
    globalThis.fetch = async () => { requests++; throw new Error("Unexpected request"); };
    console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args); };
    try {
      for (const invalid of [undefined, "", "legacy-test-key", "sb_" + "secret_test_key", "sb_publishable_", "sb_publishable_bad key", "sb_publishable_test_key\n"]) {
        if (invalid === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = invalid;
        assert.throws(read, (error: unknown) => error instanceof Error && (!invalid || !error.message.includes(invalid)));
      }
      assert.equal(requests, 0);
      assert.deepEqual(logs, []);
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
      assert.doesNotThrow(read);
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
      globalThis.fetch = previousFetch;
      console.log = previousLog;
      console.warn = previousWarn;
      console.error = previousError;
    }
  });
}

test("browser login and expired-session refresh use publishable config without API-key Bearer", async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    sessionStorage: { getItem: (name: string) => storage.get(name) ?? null, setItem: (name: string, value: string) => storage.set(name, value), removeItem: (name: string) => storage.delete(name) },
  } });
  const config = { url, publishableKey: key, sessionKey: "test-session" };
  try {
    const calls = await capture(async () => {
      const session = await signInWithPassword(config, "test@example.test", "fake-password");
      assert.equal(session?.access_token, userToken);
      assert.equal(await getValidAccessToken(config), userToken);
    }, () => Response.json({ access_token: userToken, refresh_token: "REFRESH_TOKEN", expires_at: 1 }));
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /grant_type=password/);
    assert.match(calls[1].url, /grant_type=refresh_token/);
    calls.forEach((call) => assertHeaders(call));
    for (const path of ["app/giris/page.tsx", "app/panel/page.tsx"]) {
      assert.match(source(path), /process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
      assert.match(source(path), /return \{ url, publishableKey, sessionKey \}/);
    }
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("admin login/refresh/logout use publishable config and preserve user logout token", async () => {
  const dependencies = { getSupabasePublicServerConfig: adminConfig, parseAuthTokens: (body: unknown) => body, readJsonBody: (response: Response) => response.json(), AdminError: Error };
  const password = privateFunction("lib/admin/auth.ts", "exchangePassword", dependencies);
  const refresh = privateFunction("lib/admin/auth.ts", "exchangeRefreshToken", dependencies);
  let cleared = false;
  const logout = privateFunction("lib/admin/auth.ts", "logoutAdminSession", {
    getSupabasePublicServerConfig: adminConfig,
    readAdminSessionCookies: async () => ({ accessToken: userToken }),
    clearAdminSessionCookies: async () => { cleared = true; },
  });
  const calls = await capture(async () => { await password("test@example.test", "fake-password"); await refresh("REFRESH_TOKEN"); await logout(); }, () => Response.json({ access_token: userToken }));
  assert.equal(calls.length, 3);
  assertHeaders(calls[0]);
  assertHeaders(calls[1]);
  assertHeaders(calls[2], userToken);
  assert.equal(cleared, true);
});

test("password recovery passes publishable key to the SDK without overriding SDK headers", () => {
  let args: unknown[] = [];
  const create = privateFunction("lib/supabase-client.ts", "createBrowserSupabaseClient", {
    isSupabasePublishableKey, browserClient: null,
    createClient: (...received: unknown[]) => { args = received; return {}; },
  });
  create();
  assert.deepEqual(args, [url, key, { auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true } }]);
  const recovery = source("app/sifre-yenile/page.tsx");
  for (const method of ["createBrowserSupabaseClient", "exchangeCodeForSession", "getSession", "resetPasswordForEmail", "updateUser", "signOut"]) assert.ok(recovery.includes(method));
  assert.doesNotMatch(source("lib/supabase-client.ts"), /Authorization|Bearer/);
});

test("all nine env readers validate the new key without a legacy fallback", () => {
  const paths = ["app/giris/page.tsx", "app/panel/page.tsx", "app/api/business/orders/_utils.ts", "app/api/business/products/_utils.ts", "app/api/business/update-profile/route.ts", "lib/admin/config.ts", "lib/public-business-server.ts", "lib/supabase-business.ts", "lib/supabase-client.ts"];
  const retiredEnv = ["NEXT_PUBLIC", "SUPABASE", "ANON", "KEY"].join("_");
  for (const path of paths) {
    const text = source(path);
    assert.match(text, /process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    assert.match(text, /!isSupabasePublishableKey\(publishableKey\)/);
    assert.equal(text.includes(retiredEnv), false);
    assert.doesNotMatch(text, /Bearer[^\n]*publishableKey/);
  }
});
