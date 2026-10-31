import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { isSameOriginAdminRequest } from "../../../../../lib/admin/same-origin";

// Execute the real route with synthetic cookie/provider boundaries. No Next
// request context, production configuration or upstream Auth calls are used.
function route() {
  let cookiesCleared = 0;
  let providerLogouts = 0;
  const javascript = ts.transpileModule(readFileSync(new URL("./route.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", javascript)((name: string) => {
    if (name.endsWith("/auth")) return { logoutAdminSession: async () => { providerLogouts++; cookiesCleared++; } };
    if (name.endsWith("/session")) return { clearAdminSessionCookies: async () => { cookiesCleared++; } };
    if (name.endsWith("/http")) return {
      assertSameOriginAdminMutation(request: Request) {
        if (!isSameOriginAdminRequest(request)) throw new Error("Synthetic origin rejection");
      },
      adminJson: (body: unknown) => Response.json(body),
      adminErrorResponse: () => Response.json({ error: "rejected" }, { status: 403 }),
    };
    throw new Error("Unexpected route dependency");
  }, exports);
  assert.ok(exports.POST);
  return { post: exports.POST, counts: () => ({ cookiesCleared, providerLogouts }) };
}

test("recovery browser logout clears cookies without revoking another account's sessions", async () => {
  const handler = route();
  const response = await handler.post(new Request("http://127.0.0.1:3100/api/admin/auth/logout?scope=browser", {
    method: "POST", headers: { Origin: "http://127.0.0.1:3100" },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.deepEqual(handler.counts(), { cookiesCleared: 1, providerLogouts: 0 });
});
test("normal admin logout retains provider revocation and cookie cleanup", async () => {
  const handler = route();
  assert.equal((await handler.post(new Request("http://127.0.0.1:3100/api/admin/auth/logout", {
    method: "POST", headers: { Origin: "http://127.0.0.1:3100" },
  }))).status, 200);
  assert.deepEqual(handler.counts(), { cookiesCleared: 1, providerLogouts: 1 });
});
for (const origin of [undefined, "https://untrusted.example.invalid"]) {
  test("cookie-only cleanup rejects missing or foreign origin", async () => {
    const handler = route();
    assert.equal((await handler.post(new Request("http://127.0.0.1:3100/api/admin/auth/logout?scope=browser", {
      method: "POST", headers: origin ? { Origin: origin } : {},
    }))).status, 403);
    assert.deepEqual(handler.counts(), { cookiesCleared: 0, providerLogouts: 0 });
  });
}
