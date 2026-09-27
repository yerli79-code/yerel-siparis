import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");

const deleteRouteSource = source("app/api/admin/delete-business/route.ts");
const updateRouteSource = source("app/api/admin/update-business/route.ts");
const patchBusinessRouteSource = source("app/api/admin/businesses/[id]/route.ts");
const detailClientSource = source("app/admin/isletmeler/[id]/business-detail-client.tsx");
const supabaseAdminSource = source("lib/supabase-admin.ts");
const adminHttpSource = source("lib/admin/http.ts");
const adminErrorsSource = source("lib/admin/errors.ts");

class MockAdminError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function loadRouteHandler(
  routeCode: string,
  options: {
    authError?: MockAdminError;
    csrfError?: MockAdminError;
  } = {},
) {
  const transpiled = ts.transpileModule(routeCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const calls = {
    auth: 0,
    csrf: 0,
  };

  const loaded = { exports: {} as Record<string, unknown> };

  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier.endsWith("auth")) {
      return {
        requireAdmin: async () => {
          calls.auth += 1;
          if (options.authError) throw options.authError;
          return { userId: "00000000-0000-0000-0000-000000000001", email: "admin@yerelsiparis.com" };
        },
      };
    }
    if (specifier.endsWith("errors")) {
      return { AdminError: MockAdminError };
    }
    if (specifier.endsWith("http")) {
      return {
        assertSameOriginAdminMutation: (request: Request) => {
          calls.csrf += 1;
          if (options.csrfError) throw options.csrfError;
          const origin = request.headers.get("origin");
          if (!origin || origin !== new URL(request.url).origin) {
            throw new MockAdminError("CSRF_REJECTED", "İstek kaynağı doğrulanamadı.", 403);
          }
        },
        adminErrorResponse: (error: unknown, fallbackMessage: string) => {
          const controlled =
            error instanceof MockAdminError
              ? error
              : new MockAdminError("ADMIN_UNAVAILABLE", fallbackMessage, 503);
          return new Response(
            JSON.stringify({
              error: {
                code: controlled.code,
                message: controlled.message,
              },
            }),
            {
              status: controlled.status,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "private, no-store, max-age=0",
                Vary: "Cookie",
              },
            },
          );
        },
      };
    }
    throw new Error(`Unexpected import in test: ${specifier}`);
  };

  Function("require", "exports", "module", transpiled)(localRequire, loaded.exports, loaded);

  return {
    POST: loaded.exports.POST as (request: Request) => Promise<Response>,
    calls,
  };
}

// ==========================================
// A. Hard-delete Admin UI action is absent
// ==========================================
test("A. permanent delete action is absent from business detail UI", () => {
  assert.doesNotMatch(detailClientSource, /Kalıcı Sil/);
  assert.doesNotMatch(detailClientSource, /deleteBusinessInSupabase/);
  assert.doesNotMatch(detailClientSource, /async function deleteBusiness/);
  assert.doesNotMatch(detailClientSource, /run: deleteBusiness/);
});

test("A. business detail UI preserves safe operational shutdown controls", () => {
  assert.match(detailClientSource, /deactivateAdminBusiness/);
  assert.match(detailClientSource, /reactivateAdminBusiness/);
  assert.match(detailClientSource, /blockAdminBusiness/);
  assert.match(detailClientSource, /resetAdminBusinessSubscription/);
  assert.match(detailClientSource, /extendAdminBusinessSubscription/);
  assert.match(detailClientSource, /setAdminBusinessSubscriptionDate/);
});

// ==========================================
// B & C. POST /api/admin/delete-business is non-mutating and retired with HTTP 410
// ==========================================
test("B. delete-business route does not invoke any database mutation", () => {
  assert.doesNotMatch(deleteRouteSource, /adminServiceFetch/);
  assert.doesNotMatch(deleteRouteSource, /deleteProductsByBusinessId/);
  assert.doesNotMatch(deleteRouteSource, /deleteBusinessById/);
  assert.doesNotMatch(deleteRouteSource, /DELETE/);
});

test("C. delete-business route rejects cross-origin request before execution", async () => {
  const handler = loadRouteHandler(deleteRouteSource);
  const request = new Request("https://yerelsiparis.com/api/admin/delete-business", {
    method: "POST",
    headers: { origin: "https://evil.com" },
  });
  const response = await handler.POST(request);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "CSRF_REJECTED");
  assert.equal(handler.calls.csrf, 1);
  assert.equal(handler.calls.auth, 0);
});

test("C. delete-business route rejects unauthenticated request", async () => {
  const handler = loadRouteHandler(deleteRouteSource, {
    authError: new MockAdminError("UNAUTHORIZED", "Admin oturumu bulunamadı.", 401),
  });
  const request = new Request("https://yerelsiparis.com/api/admin/delete-business", {
    method: "POST",
    headers: { origin: "https://yerelsiparis.com" },
  });
  const response = await handler.POST(request);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("C. delete-business route returns HTTP 410 with LEGACY_ENDPOINT_RETIRED for authenticated admin", async () => {
  const handler = loadRouteHandler(deleteRouteSource);
  const request = new Request("https://yerelsiparis.com/api/admin/delete-business", {
    method: "POST",
    headers: { origin: "https://yerelsiparis.com" },
    body: JSON.stringify({ businessId: "00000000-0000-0000-0000-000000000002" }),
  });
  const response = await handler.POST(request);
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("Vary"), "Cookie");

  const body = await response.json();
  assert.equal(body.error.code, "LEGACY_ENDPOINT_RETIRED");
  assert.match(body.error.message, /Kalıcı işletme silme işlemi devre dışı bırakıldı/);
});

// ==========================================
// D. POST /api/admin/update-business is non-mutating and retired with HTTP 410
// ==========================================
test("D. update-business route does not invoke any database mutation", () => {
  assert.doesNotMatch(updateRouteSource, /adminServiceFetch/);
  assert.doesNotMatch(updateRouteSource, /updateBusinessInSupabase/);
  assert.doesNotMatch(updateRouteSource, /fetch\(/);
  assert.match(updateRouteSource, /PATCH \/api\/admin\/businesses\/\[id\]/);
});

test("D. update-business route rejects cross-origin request before execution", async () => {
  const handler = loadRouteHandler(updateRouteSource);
  const request = new Request("https://yerelsiparis.com/api/admin/update-business", {
    method: "POST",
    headers: { origin: "https://evil.com" },
  });
  const response = await handler.POST(request);
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error.code, "CSRF_REJECTED");
  assert.equal(handler.calls.csrf, 1);
  assert.equal(handler.calls.auth, 0);
});

test("D. update-business route rejects unauthenticated request", async () => {
  const handler = loadRouteHandler(updateRouteSource, {
    authError: new MockAdminError("UNAUTHORIZED", "Admin oturumu bulunamadı.", 401),
  });
  const request = new Request("https://yerelsiparis.com/api/admin/update-business", {
    method: "POST",
    headers: { origin: "https://yerelsiparis.com" },
  });
  const response = await handler.POST(request);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "UNAUTHORIZED");
});

test("D. update-business route returns HTTP 410 with LEGACY_ENDPOINT_RETIRED directing to modern PATCH endpoint", async () => {
  const handler = loadRouteHandler(updateRouteSource);
  const request = new Request("https://yerelsiparis.com/api/admin/update-business", {
    method: "POST",
    headers: { origin: "https://yerelsiparis.com" },
    body: JSON.stringify({ id: "00000000-0000-0000-0000-000000000002", name: "New Name" }),
  });
  const response = await handler.POST(request);
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("Vary"), "Cookie");

  const body = await response.json();
  assert.equal(body.error.code, "LEGACY_ENDPOINT_RETIRED");
  assert.match(body.error.message, /PATCH \/api\/admin\/businesses\/\[id\]/);
});

// ==========================================
// E. Modern PATCH /api/admin/businesses/[id] remains unchanged
// ==========================================
test("E. modern PATCH route exists and uses safe optimistic patch contract", () => {
  assert.equal(existsSync(new URL("app/api/admin/businesses/[id]/route.ts", root)), true);
  assert.match(patchBusinessRouteSource, /export async function PATCH/);
  assert.match(patchBusinessRouteSource, /parseAdminBusinessSafePatch/);
  assert.match(patchBusinessRouteSource, /updateAdminBusinessSafely/);
  assert.match(patchBusinessRouteSource, /assertSameOriginAdminMutation/);
  assert.match(patchBusinessRouteSource, /requireAdmin/);
});

// ==========================================
// F. Audited critical operations remain available
// ==========================================
test("F. all 5 dedicated critical routes exist and maintain audited RPC contract", () => {
  const criticalRoutePaths = [
    "app/api/admin/businesses/[id]/deactivate/route.ts",
    "app/api/admin/businesses/[id]/reactivate/route.ts",
    "app/api/admin/businesses/[id]/block/route.ts",
    "app/api/admin/businesses/[id]/reset-subscription/route.ts",
    "app/api/admin/businesses/[id]/subscription/route.ts",
  ];
  for (const path of criticalRoutePaths) {
    assert.equal(existsSync(new URL(path, root)), true, `${path} must exist`);
    const content = source(path);
    assert.match(content, /requireAdmin/);
    assert.match(content, /assertSameOriginAdminMutation/);
    assert.match(content, /applyAdminBusinessAction/);
  }
});

// ==========================================
// G. Client library has retired mutation helpers removed
// ==========================================
test("G. retired mutation helpers are completely absent from lib/supabase-admin.ts", () => {
  assert.doesNotMatch(supabaseAdminSource, /deleteBusinessInSupabase/);
  assert.doesNotMatch(supabaseAdminSource, /updateBusinessInSupabase/);
  assert.doesNotMatch(supabaseAdminSource, /AdminUpdateBusinessInput/);
  assert.doesNotMatch(supabaseAdminSource, /DeleteBusinessResult/);
});

test("controlled error contract includes LEGACY_ENDPOINT_RETIRED", () => {
  assert.match(adminErrorsSource, /"LEGACY_ENDPOINT_RETIRED"/);
  assert.match(adminHttpSource, /"LEGACY_ENDPOINT_RETIRED"/);
});
