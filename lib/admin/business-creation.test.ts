import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), "utf8");
const adapterSource = source("lib/admin/business-creation.ts");
const routeSource = source("app/api/admin/create-business/route.ts");
const ownerId = "11111111-1111-4111-8111-111111111111";
const actor = { userId: "22222222-2222-4222-8222-222222222222", email: "admin@example.test" };

class TestAdminError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

function load(sourceText: string, imports: Record<string, unknown>) {
  const javascript = ts.transpileModule(sourceText, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  Function("require", "exports", "module", javascript)(
    (specifier: string) => {
      if (specifier === "server-only") return {};
      if (specifier in imports) return imports[specifier];
      throw new Error(`Unexpected import: ${specifier}`);
    }, module.exports, module,
  );
  return module.exports;
}

const input = {
  businessId: "33333333-3333-4333-8333-333333333333",
  ownerId,
  slug: "synthetic-business",
  name: "Synthetic Business",
  description: "",
  whatsappOrderNumber: "5551234567",
  city: "İstanbul",
  district: "Kadıköy",
  neighborhood: "Moda",
  address: "",
  subscriptionStatus: "active" as const,
  subscriptionStartedAt: null,
  subscriptionExpiresAt: null,
  isActive: false,
  actor,
};
const created = { id: input.businessId, owner_id: ownerId, slug: input.slug, name: input.name };

function adapter() {
  return load(adapterSource, {
    "./errors": { AdminError: TestAdminError },
    "./dal": { readJsonBody: (response: Response) => response.json() },
  }) as {
    createBusinessWithAudit: (value: typeof input, fetcher: Function) => Promise<Record<string, unknown>>;
    reconcileBusinessCreation: (id: string, fetcher: Function) => Promise<Record<string, unknown>>;
  };
}

test("RPC sends a typed server-controlled body and maps success, duplicate, validation and lost response", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const serviceFetch = async (path: string, init: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(init.body)) });
    return Response.json({ ok: true, business: created });
  };
  const api = adapter();
  assert.deepEqual(await api.createBusinessWithAudit(input, serviceFetch), { kind: "success", business: created });
  assert.equal(calls[0].path, "/rest/v1/rpc/admin_create_business_with_audit");
  assert.equal(calls[0].body.p_business_id, input.businessId);
  assert.equal(calls[0].body.p_actor_user_id, actor.userId);
  assert.equal(calls[0].body.p_actor_email, actor.email);
  assert.equal("temporaryPassword" in calls[0].body, false);
  assert.equal((await api.createBusinessWithAudit(input, async () =>
    Response.json({ code: "23505" }, { status: 409 }))).kind, "known-failure");
  assert.equal((await api.createBusinessWithAudit(input, async () =>
    Response.json({ code: "22023" }, { status: 400 }))).kind, "known-failure");
  assert.deepEqual(await api.createBusinessWithAudit(input, async () => {
    throw new Error("connection lost");
  }), { kind: "ambiguous" });
});

test("reconciliation requires both records and treats partial or unreadable state as unknown", async () => {
  const api = adapter();
  const fetcher = (business: unknown[], audit: unknown[], status = 200) =>
    async (path: string) => Response.json(
      path.includes("/businesses?") ? business : audit, { status },
    );
  const audit = { id: "44444444-4444-4444-8444-444444444444", business_id: input.businessId, action: "business.created" };
  assert.deepEqual(await api.reconcileBusinessCreation(input.businessId, fetcher([created], [audit])),
    { kind: "committed", business: created });
  assert.deepEqual(await api.reconcileBusinessCreation(input.businessId, fetcher([], [])),
    { kind: "not-committed" });
  for (const [businesses, audits] of [[[created], []], [[], [audit]]] as const) {
    assert.deepEqual(await api.reconcileBusinessCreation(input.businessId, fetcher([...businesses], [...audits])),
      { kind: "unknown" });
  }
  assert.deepEqual(await api.reconcileBusinessCreation(input.businessId, fetcher([], [], 503)),
    { kind: "unknown" });
});

type RouteHarness = {
  outcome?: Record<string, unknown>;
  reconciliation?: Record<string, unknown>;
  profileDeleteFails?: boolean;
  authDeleteFails?: boolean;
};

function routeHarness(options: RouteHarness) {
  const calls: string[] = [];
  let rpcInput: Record<string, unknown> | undefined;
  const route = load(routeSource, {
    "../../../../lib/locations/server": { isValidStandardBusinessLocation: async () => true },
    "../../../../lib/admin/auth": { requireAdmin: async () => actor },
    "../../../../lib/admin/errors": { AdminError: TestAdminError },
    "../../../../lib/admin/http": {
      assertSameOriginAdminMutation: () => {},
      adminJson: (value: unknown, init?: ResponseInit) => Response.json(value, init),
      adminErrorResponse: (error: unknown) => {
        const e = error as TestAdminError;
        return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status || 503 });
      },
      invalidAdminRequest: (message: string) => { throw new TestAdminError("INVALID_REQUEST", message, 400); },
    },
    "../../../../lib/admin/dal": {
      adminServiceFetch: async (path: string, init?: RequestInit) => {
        calls.push(`${init?.method || "GET"} ${path}`);
        if (path.includes("businesses?slug=")) return Response.json([]);
        if (path === "/auth/v1/admin/users") return Response.json({ id: ownerId });
        if (path.includes("profiles?on_conflict")) return Response.json([{ id: ownerId }]);
        if (path.includes("profiles?id=")) return new Response(null, { status: options.profileDeleteFails ? 503 : 204 });
        if (path.includes("/auth/v1/admin/users/")) return new Response(null, { status: options.authDeleteFails ? 503 : 204 });
        throw new Error(`Unexpected service fetch: ${path}`);
      },
      readJsonBody: async (response: Response) => response.json(),
    },
    "../../../../lib/admin/business-creation": {
      createBusinessWithAudit: async (value: Record<string, unknown>) => {
        calls.push("RPC");
        rpcInput = value;
        return options.outcome ?? { kind: "success", business: { ...created, id: value.businessId } };
      },
      reconcileBusinessCreation: async (id: string) => {
        calls.push(`RECONCILE ${id}`);
        return options.reconciliation ?? { kind: "unknown" };
      },
    },
  }) as { POST: (request: Request) => Promise<Response> };
  const request = new Request("http://localhost/api/admin/create-business", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: input.slug, name: input.name, whatsappOrderNumber: input.whatsappOrderNumber,
      city: input.city, district: input.district, neighborhood: input.neighborhood,
      ownerEmail: "owner@example.test", temporaryPassword: "secret123" }),
  });
  return { run: () => route.POST(request), calls, rpcInput: () => rpcInput };
}

test("route generates UUID, passes verified actor, and keeps the existing success contract", async () => {
  const harness = routeHarness({});
  const response = await harness.run();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.business.slug, input.slug);
  assert.match(harness.rpcInput()?.businessId as string, /^[0-9a-f]{8}-/);
  assert.deepEqual(harness.rpcInput()?.actor, actor);
  assert.equal(harness.calls.at(-1), "RPC");
});

test("known duplicate and confirmed noncommit compensate profile and Auth", async () => {
  for (const options of [
    { outcome: { kind: "known-failure", error: new TestAdminError("DUPLICATE_SLUG", "Duplicate", 409) } },
    { outcome: { kind: "ambiguous" }, reconciliation: { kind: "not-committed" } },
  ]) {
    const harness = routeHarness(options);
    const response = await harness.run();
    assert.equal(response.status, options.outcome.kind === "known-failure" ? 409 : 503);
    assert.ok(harness.calls.some((call) => call.startsWith("DELETE /rest/v1/profiles")));
    assert.ok(harness.calls.some((call) => call.startsWith("DELETE /auth/v1/admin/users/")));
  }
});

test("cleanup failures are reported after confirmed noncommit", async () => {
  for (const option of ["profileDeleteFails", "authDeleteFails"] as const) {
    const harness = routeHarness({
      outcome: { kind: "ambiguous" }, reconciliation: { kind: "not-committed" }, [option]: true,
    });
    const body = await (await harness.run()).json();
    assert.match(body.error.message, option === "profileDeleteFails" ? /profiles tablosunu manuel/ : /Supabase Auth üzerinden manuel/);
  }
});

test("ambiguous committed result succeeds; partial state preserves Auth and profile", async () => {
  const committed = routeHarness({ outcome: { kind: "ambiguous" },
    reconciliation: { kind: "committed", business: created } });
  assert.equal((await committed.run()).status, 200);
  assert.equal(committed.calls.some((call) => call.startsWith("DELETE ")), false);
  const unknown = routeHarness({ outcome: { kind: "ambiguous" }, reconciliation: { kind: "unknown" } });
  const response = await unknown.run();
  assert.equal(response.status, 503);
  assert.equal(unknown.calls.some((call) => call.startsWith("DELETE ")), false);
  assert.match((await response.json()).error.message, /manuel inceleme/);
});
