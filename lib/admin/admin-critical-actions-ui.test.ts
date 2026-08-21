import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const clientSource = source("lib/supabase-admin.ts");
const detailSource = source("app/admin/isletmeler/[id]/business-detail-client.tsx");
const businessId = "11111111-1111-4111-8111-111111111111";
const updatedAt = "2026-08-21T20:00:00.000Z";
const nextUpdatedAt = "2026-08-21T20:00:01.000Z";
const success = {
  business: {
    id: businessId,
    isActive: true,
    subscriptionStatus: "active",
    subscriptionStartedAt: "2026-08-21T20:00:00.000Z",
    subscriptionExpiresAt: "2026-11-19T20:00:00.000Z",
    updatedAt: nextUpdatedAt,
  },
  auditAction: "subscription.extended",
} as const;

type RequestCall = { input: RequestInfo | URL; init: RequestInit };
type CriticalBusiness = {
  id: string;
  isActive: boolean;
  subscriptionStatus: "active" | "expired" | "blocked";
  subscriptionStartedAt: string | null;
  subscriptionExpiresAt: string | null;
  updatedAt: string;
};
type CriticalResult = { business: CriticalBusiness; auditAction: string };
type CriticalClient = {
  AdminBusinessRequestError: new (
    message: string,
    status: number,
    code: string,
  ) => Error & { status: number; code: string };
  deactivateAdminBusiness: typeof criticalSimpleAction;
  reactivateAdminBusiness: typeof criticalSimpleAction;
  blockAdminBusiness: typeof criticalSimpleAction;
  resetAdminBusinessSubscription: typeof criticalSimpleAction;
  extendAdminBusinessSubscription: (
    id: string,
    days: 30 | 60 | 90 | 180 | 365,
    version: string,
  ) => Promise<CriticalResult>;
  setAdminBusinessSubscriptionDate: (
    id: string,
    expiresOn: string,
    version: string,
  ) => Promise<CriticalResult>;
  mergeAdminBusinessCriticalState: <T extends CriticalBusiness>(
    current: T,
    authoritative: CriticalBusiness,
  ) => T;
};

function criticalSimpleAction(_id: string, _version: string): Promise<CriticalResult> {
  throw new Error("type only");
}

function loadCriticalClient(
  respond: (call: RequestCall) => Response | Promise<Response> = () => Response.json(success),
) {
  const javascript = ts.transpileModule(clientSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const calls: RequestCall[] = [];
  const loaded = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => {
    if (specifier === "./admin-client") {
      return {
        requestAdminApi: async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const call = { input, init };
          calls.push(call);
          return respond(call);
        },
      };
    }
    if (specifier === "./admin/business-audit-history-contract") {
      return { parseAdminBusinessAuditHistoryResponse: () => null };
    }
    throw new Error(`Unexpected client test import: ${specifier}`);
  };
  Function("require", "exports", "module", javascript)(
    localRequire,
    loaded.exports,
    loaded,
  );
  return { calls, client: loaded.exports as unknown as CriticalClient };
}

function requestBody(call: RequestCall) {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

const simpleCases = [
  ["deactivateAdminBusiness", "deactivate"],
  ["reactivateAdminBusiness", "reactivate"],
  ["blockAdminBusiness", "block"],
  ["resetAdminBusinessSubscription", "reset-subscription"],
] as const;

for (const [helper, path] of simpleCases) {
  test(`${helper} uses the UUID route and exact version-only body`, async () => {
    const { calls, client } = loadCriticalClient();
    await client[helper](businessId, updatedAt);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, `/api/admin/businesses/${businessId}/${path}`);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(requestBody(calls[0]), { expectedUpdatedAt: updatedAt });
  });
}

test("extend uses PATCH and the exact operation, days and version properties", async () => {
  const { calls, client } = loadCriticalClient();
  await client.extendAdminBusinessSubscription(businessId, 90, updatedAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, `/api/admin/businesses/${businessId}/subscription`);
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(requestBody(calls[0]), {
    operation: "extend",
    days: 90,
    expectedUpdatedAt: updatedAt,
  });
});

test("setDate sends the YYYY-MM-DD value unchanged and never creates a timestamp", async () => {
  const { calls, client } = loadCriticalClient();
  await client.setAdminBusinessSubscriptionDate(businessId, "2026-09-30", updatedAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, `/api/admin/businesses/${businessId}/subscription`);
  assert.equal(calls[0].init.method, "PATCH");
  assert.deepEqual(requestBody(calls[0]), {
    operation: "setDate",
    expiresOn: "2026-09-30",
    expectedUpdatedAt: updatedAt,
  });
});

test("critical browser requests never contain actor, slug or target business state", async () => {
  const { calls, client } = loadCriticalClient();
  await client.deactivateAdminBusiness(businessId, updatedAt);
  await client.extendAdminBusinessSubscription(businessId, 365, updatedAt);
  await client.setAdminBusinessSubscriptionDate(businessId, "2027-08-21", updatedAt);
  const forbidden = [
    "actorUserId",
    "actorEmail",
    "adminId",
    "adminEmail",
    "slug",
    "isActive",
    "subscriptionStatus",
    "subscriptionStartedAt",
    "subscriptionExpiresAt",
  ];
  for (const call of calls) {
    const body = requestBody(call);
    for (const field of forbidden) assert.equal(field in body, false, field);
  }
});

test("all critical helpers preserve requestAdminApi session behavior", () => {
  assert.match(clientSource, /requestAdminApi\([\s\S]*\/api\/admin\/businesses/);
  const criticalBlock = clientSource.slice(
    clientSource.indexOf("async function requestAdminBusinessCriticalMutation"),
    clientSource.indexOf("export function mergeAdminBusinessCriticalState"),
  );
  assert.doesNotMatch(criticalBlock, /\bfetch\(/);
});

test("authoritative minimal business state merges without dropping profile fields", () => {
  const { client } = loadCriticalClient();
  const current = {
    ...success.business,
    isActive: false,
    subscriptionStatus: "expired" as const,
    subscriptionStartedAt: null,
    subscriptionExpiresAt: null,
    updatedAt,
    name: "Korunacak İşletme",
    slug: "korunacak-isletme",
  };
  const merged = client.mergeAdminBusinessCriticalState(current, success.business);
  assert.equal(merged.name, current.name);
  assert.equal(merged.slug, current.slug);
  assert.equal(merged.isActive, success.business.isActive);
  assert.equal(merged.subscriptionExpiresAt, success.business.subscriptionExpiresAt);
  assert.equal(merged.updatedAt, nextUpdatedAt);
});

test("authoritative state for another current business is never merged", () => {
  const { client } = loadCriticalClient();
  const current = {
    ...success.business,
    id: "33333333-3333-4333-8333-333333333333",
    name: "Başka İşletme",
  };
  assert.equal(client.mergeAdminBusinessCriticalState(current, success.business), current);
});

test("a success response for another business is rejected before client state can use it", async () => {
  const wrongBusinessId = "33333333-3333-4333-8333-333333333333";
  const { client } = loadCriticalClient(() =>
    Response.json({ ...success, business: { ...success.business, id: wrongBusinessId } }),
  );
  await assert.rejects(
    () => client.deactivateAdminBusiness(businessId, updatedAt),
    (error: unknown) =>
      error instanceof client.AdminBusinessRequestError &&
      error.code === "ADMIN_UNAVAILABLE" &&
      error.status === 503,
  );
});

test("malformed success data becomes a controlled client 503", async () => {
  const { client } = loadCriticalClient(() => new Response("not-json"));
  await assert.rejects(
    () => client.blockAdminBusiness(businessId, updatedAt),
    (error: unknown) =>
      error instanceof client.AdminBusinessRequestError &&
      error.code === "ADMIN_UNAVAILABLE" &&
      error.status === 503,
  );
});

test("CONFLICT is surfaced once with the controlled Turkish message and no retry", async () => {
  const { calls, client } = loadCriticalClient(() =>
    Response.json(
      {
        error: {
          code: "CONFLICT",
          message: "İşletme başka bir işlemde güncellendi. Güncel bilgileri yükleyip tekrar deneyin.",
        },
      },
      { status: 409 },
    ),
  );
  await assert.rejects(
    () => client.deactivateAdminBusiness(businessId, updatedAt),
    (error: unknown) =>
      error instanceof client.AdminBusinessRequestError &&
      error.code === "CONFLICT" &&
      error.status === 409 &&
      error.message ===
        "İşletme başka bir işlemde güncellendi. Güncel bilgileri yükleyip tekrar deneyin.",
  );
  assert.equal(calls.length, 1);
});

test("INVALID_STATE is surfaced once as controlled 409 and never retried", async () => {
  const { calls, client } = loadCriticalClient(() =>
    Response.json(
      {
        error: {
          code: "INVALID_STATE",
          message: "İşletmenin mevcut durumu bu işleme izin vermiyor.",
        },
      },
      { status: 409 },
    ),
  );
  await assert.rejects(
    () => client.reactivateAdminBusiness(businessId, updatedAt),
    (error: unknown) =>
      error instanceof client.AdminBusinessRequestError &&
      error.code === "INVALID_STATE" &&
      error.status === 409,
  );
  assert.equal(calls.length, 1);
});

test("detail UI uses current updatedAt and authoritative response merge without a detail reload", () => {
  const commitBlock = detailSource.slice(
    detailSource.indexOf("async function commitCriticalAction"),
    detailSource.indexOf("async function deleteBusiness"),
  );
  assert.match(commitBlock, /mutate\(detail\.business\.id, detail\.business\.updatedAt\)/);
  assert.match(commitBlock, /mergeAdminBusinessCriticalState\([\s\S]*result\.business/);
  assert.match(commitBlock, /setManualDate\(dateInputValue\(result\.business\.subscriptionExpiresAt\)\)/);
  assert.doesNotMatch(commitBlock, /loadDetail\(/);
});

test("detail UI no longer calculates or sends critical target state", () => {
  for (const marker of [
    "updateBusinessSubscriptionInSupabase",
    "addDaysFromToday",
    "withBusinessAccess",
    "withReactivatedBusinessAccess",
    "endOfSelectedDate",
  ]) {
    assert.doesNotMatch(detailSource, new RegExp(marker));
  }
  assert.doesNotMatch(detailSource, /new Date\(\)\.toISOString\(\)/);
});

test("409 UI locks stale critical actions and offers the existing reload control", () => {
  assert.match(detailSource, /error\.code === "CONFLICT" \|\| error\.code === "INVALID_STATE"/);
  assert.match(detailSource, /Güncel Bilgileri Yükle/);
  assert.match(detailSource, /disabled=\{busy \|\| conflict\}/);
  assert.match(detailSource, /if \(!detail \|\| busy \|\| conflict\) return/);
  assert.doesNotMatch(
    detailSource.slice(
      detailSource.indexOf("function beginEdit"),
      detailSource.indexOf("async function saveEdit"),
    ),
    /setConflict\(false\)/,
  );
});

test("all critical confirmations and duplicate-click busy guard remain", () => {
  for (const label of [
    "Pasife Al",
    "Aktife Al",
    "Engelle",
    "Aboneliği Sıfırla",
    "Manuel abonelik bitiş tarihi",
  ]) {
    assert.match(detailSource, new RegExp(label.replace(/[+${}]/g, "\\$&")));
  }
  assert.match(detailSource, />\+\{days\} Gün<\/button>/);
  assert.match(detailSource, /if \(!confirmAction \|\| busy\) return/);
  assert.match(detailSource, /disabled=\{busy\} type="button" onClick=\{runConfirmedAction\}/);
});

test("hard delete and safe legacy business update remain while subscription mutation is retired", () => {
  assert.match(detailSource, /deleteBusinessInSupabase/);
  assert.match(detailSource, /Kalıcı Sil/);
  assert.match(clientSource, /requestAdminApi\("\/api\/admin\/delete-business"/);
  assert.equal(existsSync(new URL("app/api/admin/update-subscription/route.ts", root)), false);
  for (const path of [
    "app/api/admin/update-business/route.ts",
    "app/api/admin/delete-business/route.ts",
  ]) {
    assert.equal(existsSync(new URL(path, root)), true);
  }
});

test("P5.1E-C critical UI remains intact alongside the later audit-history section", () => {
  assert.match(detailSource, /İşlem Geçmişi/);
  assert.doesNotMatch(detailSource, /admin_audit_logs/);
  for (const label of ["Pasife Al", "Aktife Al", "Engelle", "Aboneliği Sıfırla", "Kalıcı Sil"]) {
    assert.match(detailSource, new RegExp(label));
  }
});
