import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import {
  ADMIN_BUSINESS_AUDIT_HISTORY_LIMIT,
  ADMIN_BUSINESS_AUDIT_HISTORY_SELECT,
  getAdminAuditActionLabel,
  parseAdminBusinessAuditHistoryResponse,
  // @ts-expect-error Node's type-stripping test runner requires the source extension.
} from "./business-audit-history-contract.ts";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const route = source("app/api/admin/businesses/[id]/audit-history/route.ts");
const dal = source("lib/admin/business-audit-history.ts");
const contract = source("lib/admin/business-audit-history-contract.ts");
const browserClient = source("lib/supabase-admin.ts");
const detailClient = source("app/admin/isletmeler/[id]/business-detail-client.tsx");
const adminHttp = source("lib/admin/http.ts");
const businessId = "11111111-1111-4111-8111-111111111111";
const auditId = "22222222-2222-4222-8222-222222222222";

const state = {
  is_active: false,
  subscription_status: "expired",
  subscription_started_at: null,
  subscription_expires_at: null,
  updated_at: "2026-08-21T20:00:00.000Z",
};

const auditRow = {
  id: auditId,
  action: "subscription.extended",
  actor_email: "admin@example.com",
  created_at: "2026-08-21T20:42:00.000Z",
  before_state: state,
  after_state: {
    ...state,
    is_active: true,
    subscription_status: "active",
    subscription_started_at: "2026-08-21T20:42:00.000Z",
    subscription_expires_at: "2026-11-19T20:42:00.000Z",
    customer_phone: "must-not-leak",
  },
};

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

type AuditDal = {
  fetchAdminBusinessAuditHistory: (
    id: string,
  ) => Promise<Array<Record<string, unknown>> | null>;
};

function loadAuditDal(responses: Response[]) {
  const javascript = ts.transpileModule(dal, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const calls: string[] = [];
  const queue = [...responses];
  const loaded = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => {
    if (specifier === "server-only") return {};
    if (specifier === "./business-audit-history-contract") {
      return {
        ADMIN_BUSINESS_AUDIT_HISTORY_LIMIT,
        ADMIN_BUSINESS_AUDIT_HISTORY_SELECT,
      };
    }
    if (specifier === "./business-detail-contract") {
      return {
        isCanonicalUuid: (value: string) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
      };
    }
    if (specifier === "./errors") return { AdminError: TestAdminError };
    if (specifier === "./dal") {
      return {
        adminServiceFetch: async (path: string) => {
          calls.push(path);
          const response = queue.shift();
          if (!response) throw new Error("unexpected fetch");
          return response;
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
    throw new Error(`Unexpected audit DAL import: ${specifier}`);
  };
  Function("require", "exports", "module", javascript)(
    localRequire,
    loaded.exports,
    loaded,
  );
  return { calls, auditDal: loaded.exports as unknown as AuditDal };
}

function safeDto() {
  return {
    items: [
      {
        id: auditId,
        action: "subscription.extended",
        actorEmail: "admin@example.com",
        createdAt: "2026-08-21T20:42:00.000Z",
        before: {
          isActive: false,
          subscriptionStatus: "expired",
          subscriptionStartedAt: null,
          subscriptionExpiresAt: null,
        },
        after: {
          isActive: true,
          subscriptionStatus: "active",
          subscriptionStartedAt: "2026-08-21T20:42:00.000Z",
          subscriptionExpiresAt: "2026-11-19T20:42:00.000Z",
        },
      },
    ],
  };
}

test("audit endpoint is authenticated, UUID-only and private no-store", () => {
  assert.match(route, /params:\s*Promise<\{ id: string \}>/);
  assert.ok(route.indexOf("await requireAdmin()") < route.indexOf("await readBusinessId(context)"));
  assert.match(route, /isCanonicalUuid\(id\)/);
  assert.doesNotMatch(route, /slug|fallback/i);
  assert.match(route, /adminJson\(\{ items \}\)/);
  assert.match(adminHttp, /private, no-store, max-age=0/);
  assert.match(adminHttp, /Vary:\s*"Cookie"/);
});

test("audit endpoint and DAL are read-only and the service-role boundary stays server-only", () => {
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (?:POST|PATCH|PUT|DELETE)/);
  assert.match(dal, /^import "server-only";/);
  assert.match(dal, /adminServiceFetch\(`\/rest\/v1\/admin_audit_logs/);
  assert.doesNotMatch(`${route}\n${dal}`, /method:\s*"(?:POST|PATCH|PUT|DELETE)"/);
  assert.doesNotMatch(`${detailClient}\n${browserClient}`, /admin_audit_logs/);
  assert.doesNotMatch(browserClient, /SUPABASE_SERVICE_ROLE|serviceRoleKey/);
});

test("audit query uses the minimal select, deterministic newest-first order and 20-row limit", async () => {
  assert.equal(ADMIN_BUSINESS_AUDIT_HISTORY_LIMIT, 20);
  assert.equal(
    ADMIN_BUSINESS_AUDIT_HISTORY_SELECT,
    "id,action,actor_email,created_at,before_state,after_state",
  );
  const { calls, auditDal } = loadAuditDal([
    Response.json([{ id: businessId }]),
    Response.json([auditRow]),
  ]);
  const result = await auditDal.fetchAdminBusinessAuditHistory(businessId);
  assert.equal(calls.length, 2);
  const url = new URL(calls[1], "https://example.test");
  assert.equal(url.searchParams.get("business_id"), `eq.${businessId}`);
  assert.equal(url.searchParams.get("select"), ADMIN_BUSINESS_AUDIT_HISTORY_SELECT);
  assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(result?.[0].actorEmail, "admin@example.com");
});

test("an existing business with no audits returns an empty list", async () => {
  const { auditDal } = loadAuditDal([
    Response.json([{ id: businessId }]),
    Response.json([]),
  ]);
  assert.deepEqual(await auditDal.fetchAdminBusinessAuditHistory(businessId), []);
});

test("a missing business returns null before the audit table is queried", async () => {
  const { calls, auditDal } = loadAuditDal([Response.json([])]);
  assert.equal(await auditDal.fetchAdminBusinessAuditHistory(businessId), null);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/rest\/v1\/businesses\?/);
});

test("malformed database results become controlled ADMIN_UNAVAILABLE errors", async () => {
  const { auditDal } = loadAuditDal([
    Response.json([{ id: businessId }]),
    Response.json([{ ...auditRow, actor_email: null }]),
  ]);
  await assert.rejects(
    () => auditDal.fetchAdminBusinessAuditHistory(businessId),
    (error: unknown) =>
      error instanceof TestAdminError &&
      error.code === "ADMIN_UNAVAILABLE" &&
      error.status === 503 &&
      !error.message.includes("actor_email"),
  );
  assert.match(route, /adminErrorResponse\(error, "İşlem geçmişi yüklenemedi\."\)/);
  assert.doesNotMatch(`${route}\n${dal}`, /console\.(?:log|warn|error)/);
});

test("server mapping strips actor ID, updatedAt and unexpected snapshot PII", async () => {
  const { auditDal } = loadAuditDal([
    Response.json([{ id: businessId }]),
    Response.json([{ ...auditRow, actor_user_id: "forbidden", customer_email: "forbidden" }]),
  ]);
  const result = await auditDal.fetchAdminBusinessAuditHistory(businessId);
  assert.deepEqual(result, safeDto().items);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "actor_user_id",
    "actorUserId",
    "business_id",
    "customer",
    "profile",
    "owner",
    "updatedAt",
    "updated_at",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
  }
});

test("browser DTO validator rejects extra PII and malformed snapshots", () => {
  assert.deepEqual(parseAdminBusinessAuditHistoryResponse(safeDto()), safeDto());
  const withActorId = structuredClone(safeDto()) as Record<string, unknown>;
  (withActorId.items as Array<Record<string, unknown>>)[0].actorUserId = "forbidden";
  assert.equal(parseAdminBusinessAuditHistoryResponse(withActorId), null);
  const withCustomer = structuredClone(safeDto());
  (withCustomer.items[0].after as Record<string, unknown>).customerPhone = "forbidden";
  assert.equal(parseAdminBusinessAuditHistoryResponse(withCustomer), null);
});

test("all known actions have Turkish labels and unknown actions stay controlled", () => {
  const labels: Record<string, string> = {
    "business.deactivated": "Pasife alındı",
    "business.reactivated": "Aktife alındı",
    "legacy_subscription.recovered": "Eski abonelik aktifleştirildi",
    "business.blocked": "Engellendi",
    "subscription.reset": "Abonelik sıfırlandı",
    "subscription.extended": "Abonelik uzatıldı",
    "subscription.date_changed": "Abonelik tarihi değiştirildi",
  };
  for (const [action, label] of Object.entries(labels)) {
    assert.equal(getAdminAuditActionLabel(action), label);
  }
  assert.equal(getAdminAuditActionLabel("future.action"), "Diğer kritik işlem");
});

test("audit UI uses Istanbul time, readable state summaries and never dumps raw JSON", () => {
  assert.match(detailClient, /<h3>İşlem Geçmişi<\/h3>/);
  assert.match(detailClient, /timeZone:\s*"Europe\/Istanbul"/);
  assert.match(detailClient, /Aktif:[\s\S]*→/);
  assert.match(detailClient, /Bitiş:[\s\S]*→/);
  assert.match(detailClient, /Henüz kayıtlı kritik işlem bulunmuyor\./);
  const auditSection = detailClient.slice(
    detailClient.indexOf("<h3>İşlem Geçmişi</h3>"),
    detailClient.indexOf("Kritik işlemler", detailClient.indexOf("<h3>İşlem Geçmişi</h3>")),
  );
  assert.doesNotMatch(auditSection, /JSON\.stringify|<pre|before_state|after_state/);
});

test("existing critical actions, retired route and hard delete remain unchanged", () => {
  for (const marker of [
    "deactivateAdminBusiness",
    "reactivateAdminBusiness",
    "blockAdminBusiness",
    "resetAdminBusinessSubscription",
    "extendAdminBusinessSubscription",
    "setAdminBusinessSubscriptionDate",
    "deleteBusinessInSupabase",
  ]) {
    assert.match(detailClient, new RegExp(marker));
  }
  assert.equal(existsSync(new URL("app/api/admin/update-subscription/route.ts", root)), false);
  assert.doesNotMatch(browserClient, /updateBusinessSubscriptionInSupabase/);
  assert.equal(existsSync(new URL("app/api/admin/delete-business/route.ts", root)), true);
});

test("P5.1E-E changes no schema, package, print PR #7 or reports PR #8 files", () => {
  const changed = new Set(
    `${execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: root, encoding: "utf8" })}\n${execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })}`
      .split(/\r?\n/)
      .filter(Boolean),
  );
  assert.equal([...changed].some((path) => path === "package.json" || path.endsWith("lock")), false);
  assert.equal([...changed].some((path) => path.startsWith("supabase/migrations/")), false);
  assert.equal([...changed].some((path) => path.startsWith("supabase/schema")), false);

  const protectedFiles = [
    "shared/print-contract/fixtures.ts",
    "shared/print-contract/hash.ts",
    "shared/print-contract/index.ts",
    "shared/print-contract/materialize.ts",
    "shared/print-contract/print-contract.test.ts",
    "shared/print-contract/sanitize.ts",
    "shared/print-contract/types.ts",
    "shared/print-contract/validate.ts",
    "app/api/business/reports/route.test.ts",
    "app/api/business/reports/route.ts",
    "lib/business-reports.test.ts",
    "lib/business-reports.ts",
    "supabase/migrations/20260811003255_add_print_job_foundation.sql",
    "supabase/migrations/20260811153000_add_business_reports_rpc.sql",
    "supabase/migrations/business-reports-migration.test.ts",
    "supabase/tests/print-job-foundation-migration.test.ts",
    "test/resolve-typescript.mjs",
  ];
  assert.deepEqual(protectedFiles.filter((path) => changed.has(path)), []);
});

test("contract source contains no customer, owner, profile or service-role fields", () => {
  assert.doesNotMatch(contract, /customer|owner|profile|serviceRole|actorUserId/i);
});
