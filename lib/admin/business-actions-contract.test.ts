import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import {
  ADMIN_BUSINESS_EXTENSION_DAYS,
  AdminBusinessActionContractError,
  buildAdminBusinessActionRpcBody,
  isCanonicalBusinessUuid,
  isExpectedAdminBusinessAuditAction,
  isValidCalendarDate,
  parseAdminBusinessActionRpcResult,
  parseAdminBusinessSimpleActionRequest,
  parseAdminBusinessSubscriptionRequest,
  // @ts-expect-error Node's type-stripping test runner requires the source extension.
} from "./business-actions-contract.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const businessId = "11111111-1111-4111-8111-111111111111";
const actor = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "admin@example.com",
};
const updatedAt = "2026-08-21T20:00:00.000Z";
const success = {
  ok: true,
  business: {
    id: businessId,
    isActive: true,
    subscriptionStatus: "active",
    subscriptionStartedAt: "2026-08-21T20:00:00.000Z",
    subscriptionExpiresAt: "2026-09-20T20:00:00.000Z",
    updatedAt: "2026-08-21T20:00:01.000Z",
  },
  auditAction: "subscription.extended",
} as const;
const routePaths = [
  "app/api/admin/businesses/[id]/deactivate/route.ts",
  "app/api/admin/businesses/[id]/reactivate/route.ts",
  "app/api/admin/businesses/[id]/block/route.ts",
  "app/api/admin/businesses/[id]/reset-subscription/route.ts",
  "app/api/admin/businesses/[id]/subscription/route.ts",
] as const;
const routes = routePaths.map(source);
const simpleRoutes = routes.slice(0, 4);
const subscriptionRoute = routes[4];
const dal = source("lib/admin/business-actions.ts");
const contract = source("lib/admin/business-actions-contract.ts");
const errors = source("lib/admin/errors.ts");
const http = source("lib/admin/http.ts");
const auth = source("lib/admin/auth.ts");
const detailClient = source("app/admin/isletmeler/[id]/business-detail-client.tsx");

class TestAdminError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function loadBusinessActionsModule() {
  const javascript = ts.transpileModule(dal, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "./dal") {
      return {
        adminServiceFetch: async () => {
          throw new Error("default service fetch must not run in unit tests");
        },
        readJsonBody: async (response: Response) => {
          const text = await response.text();
          if (!text) return null;
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return null;
          }
        },
      };
    }
    if (specifier === "./errors") return { AdminError: TestAdminError };
    if (specifier === "./business-actions-contract") {
      return {
        buildAdminBusinessActionRpcBody,
        isExpectedAdminBusinessAuditAction,
        parseAdminBusinessActionRpcResult,
      };
    }
    throw new Error(`Unexpected test import: ${specifier}`);
  };
  Function("require", "exports", "module", javascript)(
    localRequire,
    loaded.exports,
    loaded,
  );
  return loaded.exports as {
    ADMIN_BUSINESS_ACTION_RPC_PATH: string;
    applyAdminBusinessAction: (
      input: {
        businessId: string;
        action: "deactivate";
        expectedUpdatedAt: string;
        actor: typeof actor;
      },
      serviceFetch: (path: string, init: RequestInit) => Promise<Response>,
    ) => Promise<{ business: typeof success.business; auditAction: string }>;
  };
}

const actionInput = {
  businessId,
  action: "deactivate" as const,
  expectedUpdatedAt: updatedAt,
  actor,
};

function loadCriticalRoute(
  route: string,
  options: {
    authError?: TestAdminError;
    apply?: (input: Record<string, unknown>) => Promise<unknown>;
  } = {},
) {
  const javascript = ts.transpileModule(route, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const calls = {
    auth: 0,
    rpc: [] as Array<Record<string, unknown>>,
  };
  const loaded = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => {
    if (specifier.endsWith("/auth")) {
      return {
        requireAdmin: async () => {
          calls.auth += 1;
          if (options.authError) throw options.authError;
          return actor;
        },
      };
    }
    if (specifier.endsWith("/business-actions-contract")) {
      return {
        AdminBusinessActionContractError,
        isCanonicalBusinessUuid,
        parseAdminBusinessSimpleActionRequest,
        parseAdminBusinessSubscriptionRequest,
      };
    }
    if (specifier.endsWith("/business-actions")) {
      return {
        applyAdminBusinessAction: async (input: Record<string, unknown>) => {
          calls.rpc.push(input);
          if (options.apply) return options.apply(input);
          return {
            business: success.business,
            auditAction: "business.deactivated",
          };
        },
      };
    }
    if (specifier.endsWith("/http")) {
      return {
        adminJson: (body: unknown, init: ResponseInit = {}) => {
          const headers = new Headers(init.headers);
          headers.set("Cache-Control", "private, no-store, max-age=0");
          headers.set("Vary", "Cookie");
          return Response.json(body, { ...init, headers });
        },
        adminErrorResponse: (error: unknown, fallbackMessage: string) => {
          const controlled =
            error instanceof TestAdminError
              ? error
              : new TestAdminError("ADMIN_UNAVAILABLE", fallbackMessage, 503);
          return Response.json(
            { error: { code: controlled.code, message: controlled.message } },
            {
              status: controlled.status,
              headers: {
                "Cache-Control": "private, no-store, max-age=0",
                Vary: "Cookie",
              },
            },
          );
        },
        assertSameOriginAdminMutation: (request: Request) => {
          if (request.headers.get("origin") !== new URL(request.url).origin) {
            throw new TestAdminError("CSRF_REJECTED", "İstek kaynağı doğrulanamadı.", 403);
          }
        },
        invalidAdminRequest: (message: string) => {
          throw new TestAdminError("INVALID_REQUEST", message, 400);
        },
      };
    }
    throw new Error(`Unexpected route test import: ${specifier}`);
  };
  Function("require", "exports", "module", javascript)(
    localRequire,
    loaded.exports,
    loaded,
  );
  return {
    calls,
    handlers: loaded.exports as {
      POST?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
      PATCH?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
    },
  };
}

function criticalRequest(
  path: string,
  method: "POST" | "PATCH",
  body: string,
  origin = "https://preview.example.dev",
) {
  return new Request(`https://preview.example.dev${path}`, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body,
  });
}

const routeContext = (id = businessId) => ({ params: Promise.resolve({ id }) });
const runtimeRouteCases = routes.map((route, index) => ({
  route,
  method: (index === routes.length - 1 ? "PATCH" : "POST") as "POST" | "PATCH",
  path: `/api/admin/businesses/id/${routePaths[index].split("/").at(-2)}`,
  body:
    index === routes.length - 1
      ? JSON.stringify({ operation: "extend", days: 30, expectedUpdatedAt: updatedAt })
      : JSON.stringify({ expectedUpdatedAt: updatedAt }),
}));

function callRuntimeRoute(
  route: ReturnType<typeof loadCriticalRoute>,
  method: "POST" | "PATCH",
  request: Request,
  id = businessId,
) {
  const handler = method === "POST" ? route.handlers.POST : route.handlers.PATCH;
  assert.ok(handler);
  return handler(request, routeContext(id));
}

test("critical business identity accepts only canonical UUIDs", () => {
  assert.equal(isCanonicalBusinessUuid(businessId), true);
  assert.equal(isCanonicalBusinessUuid("demo-kebap"), false);
  assert.equal(isCanonicalBusinessUuid("11111111-1111-1111-1111-111111111111"), false);
});

test("simple action accepts exactly a valid expectedUpdatedAt", () => {
  assert.deepEqual(parseAdminBusinessSimpleActionRequest({ expectedUpdatedAt: ` ${updatedAt} ` }), {
    expectedUpdatedAt: updatedAt,
  });
});

test("simple action rejects a missing expectedUpdatedAt", () => {
  assert.throws(() => parseAdminBusinessSimpleActionRequest({}), AdminBusinessActionContractError);
});

test("simple action rejects invalid and empty timestamps", () => {
  for (const expectedUpdatedAt of ["", " ", "not-a-timestamp"]) {
    assert.throws(
      () => parseAdminBusinessSimpleActionRequest({ expectedUpdatedAt }),
      AdminBusinessActionContractError,
    );
  }
});

test("simple action rejects null expectedUpdatedAt", () => {
  assert.throws(
    () => parseAdminBusinessSimpleActionRequest({ expectedUpdatedAt: null }),
    AdminBusinessActionContractError,
  );
});

test("simple action rejects target isActive", () => {
  assert.throws(
    () => parseAdminBusinessSimpleActionRequest({ expectedUpdatedAt: updatedAt, isActive: false }),
    AdminBusinessActionContractError,
  );
});

test("simple action rejects target subscriptionStatus", () => {
  assert.throws(
    () => parseAdminBusinessSimpleActionRequest({ expectedUpdatedAt: updatedAt, subscriptionStatus: "blocked" }),
    AdminBusinessActionContractError,
  );
});

test("simple action rejects actor spoof fields", () => {
  for (const field of ["actorEmail", "actorUserId", "adminEmail", "adminId"]) {
    assert.throws(
      () => parseAdminBusinessSimpleActionRequest({ expectedUpdatedAt: updatedAt, [field]: "spoofed" }),
      AdminBusinessActionContractError,
    );
  }
});

test("simple action rejects random, slug and businessId fields", () => {
  for (const field of ["random", "slug", "businessId", "days", "expiresOn"]) {
    assert.throws(
      () => parseAdminBusinessSimpleActionRequest({ expectedUpdatedAt: updatedAt, [field]: "forbidden" }),
      AdminBusinessActionContractError,
    );
  }
});

test("simple action rejects arrays and null bodies", () => {
  for (const body of [null, [], [{ expectedUpdatedAt: updatedAt }]]) {
    assert.throws(() => parseAdminBusinessSimpleActionRequest(body), AdminBusinessActionContractError);
  }
});

test("extend accepts only the five product durations", () => {
  assert.deepEqual(ADMIN_BUSINESS_EXTENSION_DAYS, [30, 60, 90, 180, 365]);
  for (const days of ADMIN_BUSINESS_EXTENSION_DAYS) {
    assert.deepEqual(
      parseAdminBusinessSubscriptionRequest({ operation: "extend", days, expectedUpdatedAt: updatedAt }),
      { operation: "extend", days, expectedUpdatedAt: updatedAt },
    );
  }
});

test("extend rejects unsupported integers", () => {
  for (const days of [29, 31, 0, -30, 366]) {
    assert.throws(
      () => parseAdminBusinessSubscriptionRequest({ operation: "extend", days, expectedUpdatedAt: updatedAt }),
      AdminBusinessActionContractError,
    );
  }
});

test("extend rejects string and fractional durations", () => {
  for (const days of ["30", 30.5]) {
    assert.throws(
      () => parseAdminBusinessSubscriptionRequest({ operation: "extend", days, expectedUpdatedAt: updatedAt }),
      AdminBusinessActionContractError,
    );
  }
});

test("extend rejects expiresOn", () => {
  assert.throws(
    () => parseAdminBusinessSubscriptionRequest({ operation: "extend", days: 30, expiresOn: "2026-09-30", expectedUpdatedAt: updatedAt }),
    AdminBusinessActionContractError,
  );
});

test("setDate accepts a real YYYY-MM-DD calendar date", () => {
  assert.deepEqual(
    parseAdminBusinessSubscriptionRequest({ operation: "setDate", expiresOn: "2028-02-29", expectedUpdatedAt: updatedAt }),
    { operation: "setDate", expiresOn: "2028-02-29", expectedUpdatedAt: updatedAt },
  );
  assert.equal(isValidCalendarDate("2028-02-29"), true);
});

test("setDate rejects missing expiresOn", () => {
  assert.throws(
    () => parseAdminBusinessSubscriptionRequest({ operation: "setDate", expectedUpdatedAt: updatedAt }),
    AdminBusinessActionContractError,
  );
});

test("setDate rejects days", () => {
  assert.throws(
    () => parseAdminBusinessSubscriptionRequest({ operation: "setDate", expiresOn: "2026-09-30", days: 30, expectedUpdatedAt: updatedAt }),
    AdminBusinessActionContractError,
  );
});

test("setDate rejects non-YYYY-MM-DD formats", () => {
  for (const expiresOn of ["30-09-2026", "2026-9-30", "2026-09-30T00:00:00Z", ""]) {
    assert.throws(
      () => parseAdminBusinessSubscriptionRequest({ operation: "setDate", expiresOn, expectedUpdatedAt: updatedAt }),
      AdminBusinessActionContractError,
    );
  }
});

test("setDate rejects impossible calendar dates", () => {
  for (const expiresOn of ["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "0000-01-01"]) {
    assert.equal(isValidCalendarDate(expiresOn), false);
    assert.throws(
      () => parseAdminBusinessSubscriptionRequest({ operation: "setDate", expiresOn, expectedUpdatedAt: updatedAt }),
      AdminBusinessActionContractError,
    );
  }
});

test("subscription requests reject target-state fields", () => {
  for (const field of ["isActive", "subscriptionStatus", "subscriptionStartedAt", "subscriptionExpiresAt", "is_open"]) {
    assert.throws(
      () => parseAdminBusinessSubscriptionRequest({ operation: "extend", days: 30, expectedUpdatedAt: updatedAt, [field]: "forbidden" }),
      AdminBusinessActionContractError,
    );
  }
});

test("subscription requests reject unknown operations and non-object bodies", () => {
  for (const body of [{ operation: "reset", expectedUpdatedAt: updatedAt }, null, [], "extend"]) {
    assert.throws(() => parseAdminBusinessSubscriptionRequest(body), AdminBusinessActionContractError);
  }
});

test("deactivate RPC body uses the exact seven parameters", () => {
  assert.deepEqual(
    buildAdminBusinessActionRpcBody({ businessId, action: "deactivate", expectedUpdatedAt: updatedAt, actor }),
    {
      p_business_id: businessId,
      p_action: "deactivate",
      p_expected_updated_at: updatedAt,
      p_actor_user_id: actor.userId,
      p_actor_email: actor.email,
      p_extension_days: null,
      p_expires_on: null,
    },
  );
});

test("extend RPC body sends days and a null date", () => {
  const body = buildAdminBusinessActionRpcBody({ businessId, action: "extend_subscription", expectedUpdatedAt: updatedAt, actor, extensionDays: 90 });
  assert.equal(body.p_action, "extend_subscription");
  assert.equal(body.p_extension_days, 90);
  assert.equal(body.p_expires_on, null);
});

test("setDate RPC body sends a date and null days", () => {
  const body = buildAdminBusinessActionRpcBody({ businessId, action: "set_subscription_date", expectedUpdatedAt: updatedAt, actor, expiresOn: "2026-09-30" });
  assert.equal(body.p_action, "set_subscription_date");
  assert.equal(body.p_extension_days, null);
  assert.equal(body.p_expires_on, "2026-09-30");
});

test("RPC actor arguments are exactly the trusted server identity", () => {
  const body = buildAdminBusinessActionRpcBody({ businessId, action: "block", expectedUpdatedAt: updatedAt, actor });
  assert.equal(body.p_actor_user_id, actor.userId);
  assert.equal(body.p_actor_email, actor.email);
  assert.equal(Object.hasOwn(body, "actorEmail"), false);
  assert.equal(Object.hasOwn(body, "actorUserId"), false);
});

test("RPC body nulls extension fields that do not belong to the server action", () => {
  const body = buildAdminBusinessActionRpcBody({
    businessId,
    action: "block",
    expectedUpdatedAt: updatedAt,
    actor,
    extensionDays: 365,
    expiresOn: "2026-09-30",
  });
  assert.equal(body.p_extension_days, null);
  assert.equal(body.p_expires_on, null);
});

test("each RPC action accepts only its own audit action", () => {
  assert.equal(isExpectedAdminBusinessAuditAction("deactivate", "business.deactivated"), true);
  assert.equal(isExpectedAdminBusinessAuditAction("deactivate", "business.blocked"), false);
  assert.equal(isExpectedAdminBusinessAuditAction("reactivate", "business.reactivated"), true);
  assert.equal(isExpectedAdminBusinessAuditAction("reactivate", "legacy_subscription.recovered"), true);
});

test("strict RPC success is normalized to the minimal DTO", () => {
  assert.deepEqual(parseAdminBusinessActionRpcResult(success), success);
});

test("RPC success rejects extra business or top-level properties", () => {
  assert.equal(parseAdminBusinessActionRpcResult({ ...success, owner_id: "secret" }), null);
  assert.equal(parseAdminBusinessActionRpcResult({ ...success, business: { ...success.business, whatsapp: "secret" } }), null);
});

test("RPC success rejects a missing business", () => {
  assert.equal(parseAdminBusinessActionRpcResult({ ok: true, auditAction: "business.blocked" }), null);
});

test("RPC success rejects invalid updatedAt and UUID fields", () => {
  assert.equal(parseAdminBusinessActionRpcResult({ ...success, business: { ...success.business, updatedAt: "invalid" } }), null);
  assert.equal(parseAdminBusinessActionRpcResult({ ...success, business: { ...success.business, id: "slug" } }), null);
});

test("RPC success rejects unknown statuses and audit actions", () => {
  assert.equal(parseAdminBusinessActionRpcResult({ ...success, business: { ...success.business, subscriptionStatus: "trial" } }), null);
  assert.equal(parseAdminBusinessActionRpcResult({ ...success, auditAction: "business.deleted" }), null);
});

test("RPC parser rejects null, arrays and missing ok", () => {
  for (const value of [null, [], {}, { business: success.business }]) {
    assert.equal(parseAdminBusinessActionRpcResult(value), null);
  }
});

test("RPC NOT_FOUND logical result is accepted for HTTP mapping", () => {
  assert.deepEqual(parseAdminBusinessActionRpcResult({ ok: false, code: "NOT_FOUND" }), { ok: false, code: "NOT_FOUND" });
});

test("RPC CONFLICT logical result is accepted for HTTP mapping", () => {
  assert.deepEqual(parseAdminBusinessActionRpcResult({ ok: false, code: "CONFLICT" }), { ok: false, code: "CONFLICT" });
});

test("RPC INVALID_STATE logical result is accepted for HTTP mapping", () => {
  assert.deepEqual(parseAdminBusinessActionRpcResult({ ok: false, code: "INVALID_STATE" }), { ok: false, code: "INVALID_STATE" });
});

test("RPC unknown failure code is malformed", () => {
  assert.equal(parseAdminBusinessActionRpcResult({ ok: false, code: "DATABASE_ERROR" }), null);
});

test("RPC failure rejects extra raw database properties", () => {
  assert.equal(parseAdminBusinessActionRpcResult({ ok: false, code: "CONFLICT", details: "raw" }), null);
});

test("mock service fetch receives the exact RPC path and request body", async () => {
  const module = loadBusinessActionsModule();
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const result = await module.applyAdminBusinessAction(
    actionInput,
    async (path, init) => {
      calls.push({ path, init });
      return Response.json({ ...success, auditAction: "business.deactivated" });
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/rest/v1/rpc/admin_apply_business_action");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    p_business_id: businessId,
    p_action: "deactivate",
    p_expected_updated_at: updatedAt,
    p_actor_user_id: actor.userId,
    p_actor_email: actor.email,
    p_extension_days: null,
    p_expires_on: null,
  });
  assert.deepEqual(result, {
    business: success.business,
    auditAction: "business.deactivated",
  });
});

test("mock RPC NOT_FOUND becomes controlled HTTP 404", async () => {
  const module = loadBusinessActionsModule();
  await assert.rejects(
    () => module.applyAdminBusinessAction(actionInput, async () => Response.json({ ok: false, code: "NOT_FOUND" })),
    (error: unknown) => error instanceof TestAdminError && error.code === "NOT_FOUND" && error.status === 404,
  );
});

test("mock stale RPC conflict becomes controlled HTTP 409 without retry", async () => {
  const module = loadBusinessActionsModule();
  let calls = 0;
  await assert.rejects(
    () => module.applyAdminBusinessAction(actionInput, async () => {
      calls += 1;
      return Response.json({ ok: false, code: "CONFLICT" });
    }),
    (error: unknown) =>
      error instanceof TestAdminError &&
      error.code === "CONFLICT" &&
      error.status === 409 &&
      error.message === "İşletme başka bir işlemde güncellendi. Güncel bilgileri yükleyip tekrar deneyin.",
  );
  assert.equal(calls, 1);
});

test("mock RPC INVALID_STATE becomes controlled HTTP 409", async () => {
  const module = loadBusinessActionsModule();
  await assert.rejects(
    () => module.applyAdminBusinessAction(actionInput, async () => Response.json({ ok: false, code: "INVALID_STATE" })),
    (error: unknown) => error instanceof TestAdminError && error.code === "INVALID_STATE" && error.status === 409,
  );
});

test("mock unknown logical failure becomes ADMIN_UNAVAILABLE", async () => {
  const module = loadBusinessActionsModule();
  await assert.rejects(
    () => module.applyAdminBusinessAction(actionInput, async () => Response.json({ ok: false, code: "RAW_DATABASE_ERROR" })),
    (error: unknown) => error instanceof TestAdminError && error.code === "ADMIN_UNAVAILABLE" && error.status === 503,
  );
});

test("mock success with a different endpoint audit action becomes ADMIN_UNAVAILABLE", async () => {
  const module = loadBusinessActionsModule();
  await assert.rejects(
    () => module.applyAdminBusinessAction(actionInput, async () => Response.json(success)),
    (error: unknown) =>
      error instanceof TestAdminError &&
      error.code === "ADMIN_UNAVAILABLE" &&
      error.status === 503,
  );
});

test("mock RPC success for a different business ID becomes controlled 503", async () => {
  const module = loadBusinessActionsModule();
  const wrongBusinessId = "33333333-3333-4333-8333-333333333333";
  await assert.rejects(
    () =>
      module.applyAdminBusinessAction(actionInput, async () =>
        Response.json({
          ...success,
          business: { ...success.business, id: wrongBusinessId },
          auditAction: "business.deactivated",
        }),
      ),
    (error: unknown) =>
      error instanceof TestAdminError &&
      error.code === "ADMIN_UNAVAILABLE" &&
      error.status === 503 &&
      !error.message.includes(wrongBusinessId),
  );
});

test("mock non-JSON and HTTP 500 transports become ADMIN_UNAVAILABLE", async () => {
  const module = loadBusinessActionsModule();
  for (const response of [
    new Response("not-json", { status: 200 }),
    new Response('{"code":"XX000","message":"raw"}', { status: 500 }),
  ]) {
    await assert.rejects(
      () => module.applyAdminBusinessAction(actionInput, async () => response),
      (error: unknown) => error instanceof TestAdminError && error.code === "ADMIN_UNAVAILABLE" && error.status === 503,
    );
  }
});

test("mock network failure becomes ADMIN_UNAVAILABLE without leaking text", async () => {
  const module = loadBusinessActionsModule();
  await assert.rejects(
    () => module.applyAdminBusinessAction(actionInput, async () => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY raw network secret");
    }),
    (error: unknown) =>
      error instanceof TestAdminError &&
      error.code === "ADMIN_UNAVAILABLE" &&
      error.status === 503 &&
      !error.message.includes("SUPABASE_SERVICE_ROLE_KEY"),
  );
});

test("every critical route returns 401 and never calls RPC when unauthenticated", async () => {
  for (const testCase of runtimeRouteCases) {
    const route = loadCriticalRoute(testCase.route, {
      authError: new TestAdminError("UNAUTHORIZED", "Admin oturumu bulunamadı.", 401),
    });
    const response = await callRuntimeRoute(
      route,
      testCase.method,
      criticalRequest(testCase.path, testCase.method, testCase.body),
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "UNAUTHORIZED");
    assert.equal(route.calls.rpc.length, 0);
  }
});

test("every critical route returns 403 and never calls RPC for an inactive admin", async () => {
  for (const testCase of runtimeRouteCases) {
    const route = loadCriticalRoute(testCase.route, {
      authError: new TestAdminError("FORBIDDEN", "Bu hesap admin yetkisine sahip değil.", 403),
    });
    const response = await callRuntimeRoute(
      route,
      testCase.method,
      criticalRequest(testCase.path, testCase.method, testCase.body),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "FORBIDDEN");
    assert.equal(route.calls.rpc.length, 0);
  }
});

test("every critical route rejects cross-origin before auth or RPC", async () => {
  for (const testCase of runtimeRouteCases) {
    const route = loadCriticalRoute(testCase.route);
    const response = await callRuntimeRoute(
      route,
      testCase.method,
      criticalRequest(testCase.path, testCase.method, testCase.body, "https://attacker.example"),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "CSRF_REJECTED");
    assert.equal(route.calls.auth, 0);
    assert.equal(route.calls.rpc.length, 0);
  }
});

test("every critical route rejects an invalid UUID without RPC", async () => {
  for (const testCase of runtimeRouteCases) {
    const route = loadCriticalRoute(testCase.route);
    const response = await callRuntimeRoute(
      route,
      testCase.method,
      criticalRequest(testCase.path, testCase.method, testCase.body),
      "demo-kebap",
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
    assert.equal(route.calls.rpc.length, 0);
  }
});

test("malformed route JSON returns controlled 400 without RPC", async () => {
  const route = loadCriticalRoute(simpleRoutes[0]);
  const response = await route.handlers.POST!(
    criticalRequest("/api/admin/businesses/id/deactivate", "POST", "{"),
    routeContext(),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  assert.equal(route.calls.rpc.length, 0);
});

test("route rejects browser actor spoofing before RPC", async () => {
  const route = loadCriticalRoute(simpleRoutes[0]);
  const response = await route.handlers.POST!(
    criticalRequest(
      "/api/admin/businesses/id/deactivate",
      "POST",
      JSON.stringify({ expectedUpdatedAt: updatedAt, actorEmail: "spoof@example.com" }),
    ),
    routeContext(),
  );
  assert.equal(response.status, 400);
  assert.equal(route.calls.rpc.length, 0);
});

test("deactivate route passes the requireAdmin actor and returns private minimal success", async () => {
  const route = loadCriticalRoute(simpleRoutes[0]);
  const response = await route.handlers.POST!(
    criticalRequest("/api/admin/businesses/id/deactivate", "POST", JSON.stringify({ expectedUpdatedAt: updatedAt })),
    routeContext(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(route.calls.rpc.length, 1);
  assert.deepEqual(route.calls.rpc[0], {
    businessId,
    action: "deactivate",
    expectedUpdatedAt: updatedAt,
    actor,
  });
  assert.deepEqual(await response.json(), {
    business: success.business,
    auditAction: "business.deactivated",
  });
});

test("route returns controlled stale 409 with one RPC attempt", async () => {
  const route = loadCriticalRoute(simpleRoutes[0], {
    apply: async () => {
      throw new TestAdminError(
        "CONFLICT",
        "İşletme başka bir işlemde güncellendi. Güncel bilgileri yükleyip tekrar deneyin.",
        409,
      );
    },
  });
  const response = await route.handlers.POST!(
    criticalRequest("/api/admin/businesses/id/deactivate", "POST", JSON.stringify({ expectedUpdatedAt: updatedAt })),
    routeContext(),
  );
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "CONFLICT");
  assert.equal(route.calls.rpc.length, 1);
});

test("subscription PATCH maps extend to server action and extension days", async () => {
  const route = loadCriticalRoute(subscriptionRoute, {
    apply: async () => ({ business: success.business, auditAction: "subscription.extended" }),
  });
  const response = await route.handlers.PATCH!(
    criticalRequest(
      "/api/admin/businesses/id/subscription",
      "PATCH",
      JSON.stringify({ operation: "extend", days: 180, expectedUpdatedAt: updatedAt }),
    ),
    routeContext(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(route.calls.rpc[0], {
    businessId,
    action: "extend_subscription",
    expectedUpdatedAt: updatedAt,
    actor,
    extensionDays: 180,
  });
});

test("subscription PATCH maps setDate to server action and expiresOn", async () => {
  const route = loadCriticalRoute(subscriptionRoute, {
    apply: async () => ({ business: success.business, auditAction: "subscription.date_changed" }),
  });
  const response = await route.handlers.PATCH!(
    criticalRequest(
      "/api/admin/businesses/id/subscription",
      "PATCH",
      JSON.stringify({ operation: "setDate", expiresOn: "2026-09-30", expectedUpdatedAt: updatedAt }),
    ),
    routeContext(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(route.calls.rpc[0], {
    businessId,
    action: "set_subscription_date",
    expectedUpdatedAt: updatedAt,
    actor,
    expiresOn: "2026-09-30",
  });
});

test("subscription PATCH rejects an impossible calendar date before RPC", async () => {
  const route = loadCriticalRoute(subscriptionRoute);
  const response = await route.handlers.PATCH!(
    criticalRequest(
      "/api/admin/businesses/id/subscription",
      "PATCH",
      JSON.stringify({ operation: "setDate", expiresOn: "2026-02-30", expectedUpdatedAt: updatedAt }),
    ),
    routeContext(),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  assert.equal(route.calls.rpc.length, 0);
});

test("all five dedicated route files exist with the exact HTTP methods", () => {
  for (const path of routePaths) assert.equal(existsSync(new URL(path, root)), true);
  for (const route of simpleRoutes) assert.match(route, /export async function POST\(/);
  assert.match(subscriptionRoute, /export async function PATCH\(/);
});

test("every dedicated route uses async params and requireAdmin", () => {
  for (const route of routes) {
    assert.match(route, /params:\s*Promise<\{ id: string \}>/);
    assert.match(route, /const actor = await requireAdmin\(\)/);
    assert.ok(route.indexOf("requireAdmin()") < route.lastIndexOf("applyAdminBusinessAction"));
  }
});

test("every dedicated route enforces same-origin CSRF before RPC", () => {
  for (const route of routes) {
    assert.match(route, /assertSameOriginAdminMutation\(request\)/);
    assert.ok(route.indexOf("assertSameOriginAdminMutation(request)") < route.lastIndexOf("applyAdminBusinessAction"));
  }
});

test("every dedicated route enforces UUID-only identity before RPC", () => {
  for (const route of routes) {
    assert.match(route, /isCanonicalBusinessUuid\(id\)/);
    assert.doesNotMatch(route, /\bslug\b/);
  }
});

test("simple and subscription routes use their strict body parsers", () => {
  for (const route of simpleRoutes) assert.match(route, /parseAdminBusinessSimpleActionRequest\(body\)/);
  assert.match(subscriptionRoute, /parseAdminBusinessSubscriptionRequest\(body\)/);
});

test("endpoint paths map only to fixed server action literals", () => {
  const expected = ["deactivate", "reactivate", "block", "reset_subscription"];
  simpleRoutes.forEach((route, index) => assert.match(route, new RegExp(`action: "${expected[index]}"`)));
  assert.match(subscriptionRoute, /action: "extend_subscription"/);
  assert.match(subscriptionRoute, /action: "set_subscription_date"/);
  for (const route of routes) assert.doesNotMatch(route, /action:\s*(body|payload)\./);
});

test("routes pass actor only from requireAdmin and reject browser actor fields", () => {
  for (const route of routes) {
    assert.match(route, /const actor = await requireAdmin\(\)/);
    assert.match(route, /actor,/);
    assert.doesNotMatch(route, /body\.actor|payload\.actor|request.*actor/i);
  }
  assert.match(contract, /const SIMPLE_ACTION_KEYS = new Set\(\["expectedUpdatedAt"\]\)/);
});

test("DAL is server-only and calls only the dedicated PostgREST RPC", () => {
  assert.match(dal, /^import "server-only";/);
  assert.match(dal, /"\/rest\/v1\/rpc\/admin_apply_business_action"/);
  assert.match(dal, /serviceFetch\(ADMIN_BUSINESS_ACTION_RPC_PATH/);
  assert.doesNotMatch(dal, /\/rest\/v1\/businesses\?/);
});

test("DAL maps logical failures to controlled HTTP errors", () => {
  assert.match(dal, /"NOT_FOUND", "İşletme bulunamadı\.", 404/);
  assert.match(dal, /"CONFLICT"[\s\S]*409/);
  assert.match(dal, /"INVALID_STATE"[\s\S]*409/);
  assert.match(dal, /Güncel bilgileri yükleyip tekrar deneyin/);
  assert.match(dal, /mevcut durumu bu işleme izin vermiyor/);
});

test("transport and malformed RPC failures become controlled 503", () => {
  assert.match(dal, /catch \{[\s\S]*return unavailable\(\)/);
  assert.match(dal, /if \(!response\.ok\) return unavailable\(\)/);
  assert.match(dal, /if \(!result\) return unavailable\(\)/);
  assert.match(dal, /if \(result\.business\.id !== input\.businessId\) return unavailable\(\)/);
  assert.match(dal, /"ADMIN_UNAVAILABLE"[\s\S]*503/);
  assert.doesNotMatch(dal, /response\.statusText|console\.(log|warn|error)/);
});

test("success DTO and selects cannot leak profile, actor or service data", () => {
  const dtoBlock = contract.slice(contract.indexOf("export type AdminBusinessCriticalDto"), contract.indexOf("export type AdminBusinessActionSuccess"));
  for (const field of ["owner_id", "ownerEmail", "whatsapp", "address", "customer", "actor_user_id", "actor_email", "service_role"]) {
    assert.doesNotMatch(dtoBlock, new RegExp(field, "i"));
  }
  assert.doesNotMatch(`${dal}\n${routes.join("\n")}`, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/);
});

test("stale conflict is returned without a blind retry", () => {
  assert.match(dal, /if \(!result\.ok\) return mapLogicalFailure\(result\.code\)/);
  assert.equal((dal.match(/await serviceFetch\(/g) ?? []).length, 1);
  assert.doesNotMatch(dal, /retry|while\s*\(|for\s*\(/i);
});

test("legacy routes and hard delete remain while critical UI leaves the legacy subscription helper", () => {
  for (const path of [
    "app/api/admin/update-subscription/route.ts",
    "app/api/admin/update-business/route.ts",
    "app/api/admin/delete-business/route.ts",
  ]) {
    assert.equal(existsSync(new URL(path, root)), true);
  }
  for (const marker of ["Kalıcı Sil", "deleteBusinessInSupabase"]) {
    assert.match(detailClient, new RegExp(marker));
  }
  assert.doesNotMatch(detailClient, /updateBusinessSubscriptionInSupabase/);
});

test("controlled INVALID_STATE code and private no-store response headers are shared", () => {
  assert.match(errors, /"INVALID_STATE"/);
  assert.match(http, /"INVALID_STATE"/);
  assert.match(http, /private, no-store, max-age=0/);
  assert.match(http, /Vary:\s*"Cookie"/);
  for (const route of routes) assert.match(route, /adminJson|adminErrorResponse/);
});

test("auth semantics preserve controlled unauthorized and forbidden responses", () => {
  assert.match(auth, /"UNAUTHORIZED"[\s\S]*401/);
  assert.match(auth, /"FORBIDDEN"[\s\S]*403/);
  for (const route of routes) assert.ok(route.indexOf("requireAdmin()") < route.lastIndexOf("applyAdminBusinessAction"));
});

test("malformed and empty JSON are caught before the RPC call", () => {
  for (const route of routes) {
    assert.match(route, /try \{[\s\S]*body = await request\.json\(\);[\s\S]*\} catch \{[\s\S]*invalidAdminRequest\("Geçersiz istek gövdesi\."\)/);
    assert.ok(route.indexOf("request.json()") < route.lastIndexOf("applyAdminBusinessAction"));
  }
});
