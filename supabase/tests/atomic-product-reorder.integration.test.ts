import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Reuse the existing tests/backup/database-archive.integration.test.ts approach:
// pinned PG17 image, opt-in execution, isolated disposable container, no ports.
// Run: RUN_REORDER_PG_INTEGRATION=1 npx tsx --test supabase/tests/atomic-product-reorder.integration.test.ts
const image = "supabase/postgres:17.6.1.127";
const imageId = "sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83";
const windowsDocker = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const docker = process.env.DOCKER_CLI || (process.platform === "win32" && existsSync(windowsDocker) ? windowsDocker : "docker");
const historical = readFileSync(new URL("../migrations/20260829061343_atomic_product_reorder.sql", import.meta.url), "utf8");
const corrected = readFileSync(new URL("../migrations/20260921125217_fix_atomic_product_reorder_json_validation.sql", import.meta.url), "utf8");

function run(args: string[], stdin?: string) {
  return new Promise<{ stdout: string; stderr: string; failed: boolean }>((resolve) => {
    const child = execFile(docker, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, failed: Boolean(error) });
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin);
  });
}

async function succeeds(args: string[], stdin?: string) {
  const result = await run(args, stdin);
  assert.equal(result.failed, false, result.stderr);
  return result.stdout.trim();
}

const businessId = "33333333-3333-4333-8333-333333333333";
const otherBusinessId = "44444444-4444-4444-8444-444444444444";
const productA = "11111111-1111-4111-8111-111111111111";
const productB = "22222222-2222-4222-8222-222222222222";
const updatedAt = "2026-08-29T06:00:00.000Z";
const validItems = [
  { productId: productA, sortOrder: 2, expectedUpdatedAt: updatedAt },
  { productId: productB, sortOrder: 1, expectedUpdatedAt: updatedAt },
];

function callSql(items: unknown, owner = businessId) {
  // Synthetic test data only. No database URL or production credentials are used.
  const json = JSON.stringify(items).replace(/'/g, "''");
  return `select id, sort_order from public.reorder_business_products_atomic('${owner}'::uuid, '${json}'::jsonb);`;
}

test("reorder migration executes on isolated PostgreSQL 17", {
  skip: process.env.RUN_REORDER_PG_INTEGRATION !== "1",
  timeout: 120_000,
}, async (t) => {
  const container = `phase3b-reorder-${process.pid}-${Date.now()}`;
  let started = false;
  const sqlArgs = ["exec", "-i", container, "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "postgres", "-d", "postgres"];
  const sql = (statement: string) => succeeds(sqlArgs, statement);
  try {
    assert.equal(await succeeds(["image", "inspect", image, "--format", "{{.Id}}"]), imageId);
    await succeeds(["run", "-d", "--rm", "--pull=never", "--name", container, "--network", "none", "--env", "POSTGRES_PASSWORD=local_fixture_only", image]);
    started = true;
    assert.equal(await succeeds(["inspect", container, "--format", "{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Ports}}"]), "none|{}|{}");
    let ready = false;
    for (let attempt = 0; attempt < 45; attempt++) {
      const probe = await run(["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"]);
      if (!probe.failed) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const stableProbe = await run(["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"]);
        if (!stableProbe.failed) { ready = true; break; }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Disposable PostgreSQL must become ready");
    assert.match(await sql("show server_version;"), /^17\./);
    await sql(`
      create table public.products (
        id uuid primary key,
        business_id uuid not null,
        sort_order integer not null,
        updated_at timestamptz not null
      );
      insert into public.products values
        ('${productA}', '${businessId}', 1, '${updatedAt}'),
        ('${productB}', '${businessId}', 2, '${updatedAt}');
    `);

    await t.test("historical definition creates but valid invocation fails with undefined function", async () => {
      await sql(historical);
      const result = await run(sqlArgs, callSql(validItems));
      assert.equal(result.failed, true);
      assert.match(result.stderr, /42883/);
      assert.match(result.stderr, /function jsonb_object_length\(jsonb\) does not exist/);
    });

    await t.test("forward migration replaces the existing function and remains repeatable", async () => {
      await sql(corrected);
      await sql(corrected);
    });

    await t.test("valid two-item reorder writes and returns deterministic authoritative order", async () => {
      assert.equal(await sql(callSql(validItems)), `${productB}|1\n${productA}|2`);
      assert.equal(await sql("select id, sort_order from public.products order by sort_order, id;"), `${productB}|1\n${productA}|2`);
    });

    const rejected: Array<[string, unknown, string, string?]> = [
      ["additional key", [{ ...validItems[0], extra: true }, validItems[1]], "INVALID_PRODUCT_MUTATION"],
      ...["productId", "sortOrder", "expectedUpdatedAt"].map((key): [string, unknown, string] => {
        const item: Record<string, unknown> = { ...validItems[0] };
        delete item[key];
        return [`missing ${key}`, [item, validItems[1]], "INVALID_PRODUCT_MUTATION"];
      }),
      ["duplicate product ID", [validItems[0], { ...validItems[1], productId: productA }], "INVALID_PRODUCT_MUTATION"],
      ["duplicate sort order", [validItems[0], { ...validItems[1], sortOrder: 2 }], "INVALID_PRODUCT_MUTATION"],
      ["fractional sort order", [{ ...validItems[0], sortOrder: 1.5 }, validItems[1]], "INVALID_PRODUCT_MUTATION"],
      ["stale version", [{ ...validItems[0], expectedUpdatedAt: "2020-01-01T00:00:00Z" }, validItems[1]], "PRODUCT_CONFLICT"],
      ["other business", validItems, "PRODUCT_NOT_FOUND", otherBusinessId],
    ];
    for (const [name, items, message, owner] of rejected) {
      await t.test(`${name} is rejected without changing rows`, async () => {
        const before = await sql("select row_to_json(p) from public.products p order by id;");
        const result = await run(sqlArgs, callSql(items, owner));
        assert.equal(result.failed, true);
        assert.match(result.stderr, new RegExp(`P0001: ${message}`));
        assert.doesNotMatch(result.stderr, /42883|does not exist/);
        assert.equal(await sql("select row_to_json(p) from public.products p order by id;"), before);
      });
    }
  } finally {
    if (started) await succeeds(["rm", "-f", container]);
  }
});
