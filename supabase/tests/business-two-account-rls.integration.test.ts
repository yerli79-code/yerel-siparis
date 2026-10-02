import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Opt in from the repository root (PowerShell):
// $env:RUN_BUSINESS_ISOLATION_PG_INTEGRATION='1'; npx tsx --test supabase/tests/business-two-account-rls.integration.test.ts
// POSIX: RUN_BUSINESS_ISOLATION_PG_INTEGRATION=1 npx tsx --test supabase/tests/business-two-account-rls.integration.test.ts
// Requires local Docker and the exact pre-existing image ID below; never pulls an image.
// No Supabase URL, key, DATABASE_URL, host mount, published port or network.
// Minimal prerequisite tables are NOT a complete release schema reconstruction.
// Authorization policies/functions are loaded verbatim from checked-in migrations.
// The release intentionally exposes eligible public catalogs across accounts. Private
// orders and writes use owner-scoped server APIs, tested by business-two-account-isolation.test.ts.
const image = "supabase/postgres:17.6.1.127";
const imageId = "sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83";
const windowsDocker = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const docker = process.platform === "win32" && existsSync(windowsDocker) ? windowsDocker : "docker";
const migration = (name: string) => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const accounts = [
  { label: "A", owner: uuid(1), business: uuid(101), product: uuid(1001), hiddenProduct: uuid(1002), order: uuid(2001) },
  { label: "B", owner: uuid(2), business: uuid(102), product: uuid(1101), hiddenProduct: uuid(1102), order: uuid(2101) },
];
const publicProductIds = (account: typeof accounts[number]) =>
  [account.product, uuid(Number(account.product.slice(-12)) + 2)];

function run(args: string[], stdin?: string) {
  return new Promise<{ stdout: string; stderr: string; failed: boolean }>(resolve => {
    const child = execFile(docker, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ stdout: stdout.trim(), stderr, failed: Boolean(error) }));
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin);
  });
}
async function succeeds(args: string[], stdin?: string) {
  const result = await run(args, stdin);
  assert.equal(result.failed, false, result.stderr);
  return result.stdout;
}
function session(owner: string) {
  return `set local role authenticated;
    set local request.jwt.claim.sub = '${owner}';
    set local request.jwt.claims = '{"sub":"${owner}","role":"authenticated"}';`;
}
function reorderSql(account: typeof accounts[number]) {
  return `select id from public.reorder_business_products_atomic('${account.business}',
    '[{"productId":"${account.product}","sortOrder":2,"expectedUpdatedAt":"2026-01-01T00:00:00Z"},
      {"productId":"${uuid(Number(account.product.slice(-12)) + 2)}","sortOrder":1,"expectedUpdatedAt":"2026-01-01T00:00:00Z"}]'::jsonb);`;
}

test("two-owner checked-in PostgreSQL public catalog, private order and mutation ACL/RLS regression", {
  skip: process.env.RUN_BUSINESS_ISOLATION_PG_INTEGRATION !== "1", timeout: 180_000,
}, async t => {
  const container = `business-two-owner-rls-${process.pid}-${Date.now()}`;
  const sqlArgs = ["exec", "-i", container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
    "-v", "VERBOSITY=verbose", "-U", "supabase_admin", "-d", "postgres"];
  const sql = (statement: string) => succeeds(sqlArgs, statement);
  // Optional administrator setup is confined to the same rollback-only transaction.
  const asOwner = (owner: string, statement: string, setup = "") =>
    run(sqlArgs, `begin; ${setup} ${session(owner)} ${statement} rollback;`);
  const asAnonymous = (statement: string) =>
    run(sqlArgs, `begin; set local role anon; ${statement} rollback;`);
  const snapshot = () => sql(`select json_build_object(
    'businesses', (select json_agg(b order by id) from public.businesses b),
    'products', (select json_agg(p order by id) from public.products p),
    'orders', (select json_agg(o order by id) from public.orders o),
    'items', (select json_agg(i order by id) from public.order_items i));`);
  let started = false;
  try {
    assert.equal(await succeeds(["image", "inspect", image, "--format", "{{.Id}}"]), imageId);
    await succeeds(["run", "-d", "--rm", "--pull=never", "--name", container, "--network", "none",
      "--env", "POSTGRES_PASSWORD=local_fixture_only", image]);
    started = true;
    assert.equal(await succeeds(["inspect", container, "--format",
      "{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .HostConfig.Binds}}"]), "none|{}|null");
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (!(await run(["exec", container, "pg_isready", "-U", "postgres"])).failed) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (!(await run(["exec", container, "pg_isready", "-U", "postgres"])).failed) { ready = true; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Isolated local PostgreSQL must start");
    assert.match(await sql("show server_version;"), /^17\./);
    await sql(`
      create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $$;
      do $bootstrap$ begin
        if to_regprocedure('auth.uid()') is null then
          execute $definition$ create function auth.uid() returns uuid language sql stable as
            $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$ $definition$;
        end if;
      end $bootstrap$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      create extension if not exists pgcrypto schema extensions;
      create extension if not exists pg_cron schema pg_catalog;
      create table if not exists auth.users (id uuid primary key, email text);
      create table public.businesses (
        id uuid primary key, owner_id uuid references auth.users(id), name text not null, slug text unique,
        minimum_order_amount numeric default 0, is_open boolean default true, is_active boolean default true,
        subscription_status text default 'active', subscription_expires_at timestamptz default '2099-01-01',
        created_at timestamptz default now(), updated_at timestamptz default '2026-01-01');
      create table public.products (
        id uuid primary key, business_id uuid references public.businesses(id), name text, price numeric,
        is_active boolean default true, sort_order integer, created_at timestamptz default now(),
        updated_at timestamptz default '2026-01-01');
      create table if not exists storage.objects (id uuid primary key, bucket_id text, name text);
      alter table public.businesses enable row level security;
      alter table public.products enable row level security;
      alter table storage.objects enable row level security;
      -- Explicit baseline ACL prerequisites; no synthetic owner SELECT policies added.
      grant select, insert, update, delete on public.businesses, public.products to anon, authenticated, service_role;
      create function public.fixture_updated_at() returns trigger language plpgsql as
        $$ begin new.updated_at = clock_timestamp(); return new; end $$;
      create trigger fixture_business_updated_at before update on public.businesses
        for each row execute function public.fixture_updated_at();
      create trigger fixture_product_updated_at before update on public.products
        for each row execute function public.fixture_updated_at();
    `);
    for (const name of [
      "20260622064800_harden_rls_rpc_storage_and_product_visibility",
      "20260622070000_revoke_direct_business_writes",
      "20260622071500_harden_product_write_policies",
      "20260623090000_revoke_authenticated_direct_product_writes",
      "20260623103000_add_order_management",
      "20260801224820_add_business_dashboard_summary",
      "20260921125217_fix_atomic_product_reorder_json_validation",
    ]) await sql(migration(name));
    // Synthetic seed rows only, inserted by fixture administrator; no public order creation RPC used.
    for (const a of accounts) await sql(`
      insert into auth.users(id,email) values ('${a.owner}','owner-${a.label.toLowerCase()}@example.invalid');
      insert into public.businesses(id,owner_id,name,slug) values ('${a.business}','${a.owner}','Synthetic ${a.label}','synthetic-${a.label.toLowerCase()}');
      insert into public.products(id,business_id,name,price,is_active,sort_order) values
        ('${a.product}','${a.business}','Public ${a.label}',125,true,1),
        ('${a.hiddenProduct}','${a.business}','Hidden ${a.label}',135,false,3),
        ('${uuid(Number(a.product.slice(-12)) + 2)}','${a.business}','Public ${a.label} second',145,true,2);
      insert into public.orders(id,business_id,status,order_type,customer_name,customer_phone,total_amount)
        values ('${a.order}','${a.business}','delivered','pickup','Synthetic customer ${a.label}','0000000000',${a.label === "A" ? 125 : 250});
      insert into public.order_items(id,order_id,product_id,product_name,unit_price,quantity,line_total)
        values ('${uuid(Number(a.order.slice(-12)) + 100)}','${a.order}','${a.product}','Synthetic item ${a.label}',125,1,125);
    `);
    await t.test("client roles are neither superuser, bypass-RLS, nor table owner; RLS enabled", async () => {
      assert.equal(await sql("select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('anon','authenticated') order by rolname;"), "anon|f|f\nauthenticated|f|f");
      assert.equal(await sql("select count(*) from pg_class where oid in ('public.businesses'::regclass,'public.products'::regclass,'public.orders'::regclass,'public.order_items'::regclass) and relrowsecurity and relowner not in (select oid from pg_roles where rolname in ('anon','authenticated'));"), "4");
    });
    await t.test("anonymous public catalog exposes only active products and eligible businesses from both accounts", async () => {
      const result = await asAnonymous("select id from public.products order by id; select id from public.businesses order by id;");
      assert.equal(result.failed, false, result.stderr);
      assert.equal(result.stdout, [
        ...accounts.flatMap(publicProductIds).sort(), ...accounts.map(a => a.business).sort(),
      ].join("\n"));
    });
    for (const table of ["orders", "order_items"]) {
      await t.test(`anonymous cannot directly read private ${table}`, async () => {
        const before = await snapshot();
        const result = await asAnonymous(`select * from public.${table};`);
        assert.equal(result.failed, true, result.stdout);
        assert.match(result.stderr, /42501/);
        assert.equal(await snapshot(), before);
      });
    }
    for (let index = 0; index < accounts.length; index++) {
      const own = accounts[index], other = accounts[1 - index];
      const label = `${own.label} → ${other.label}`;
      await t.test(`${own.label}: distinct auth.uid, own public products and business/profile read`, async () => {
        const result = await asOwner(own.owner, `select auth.uid(); select id from public.products where business_id='${own.business}' and is_active order by id; select owner_id from public.businesses where id='${own.business}';`);
        assert.equal(result.failed, false, result.stderr);
        assert.equal(result.stdout, `${own.owner}\n${own.product}\n${uuid(Number(own.product.slice(-12)) + 2)}\n${own.owner}`);
      });
      // Current release deliberately puts these operations behind service-key API routes.
      for (const [name, statement] of [
        ["own orders read", `select * from public.orders where business_id='${own.business}';`],
        ["foreign orders read", `select * from public.orders where business_id='${other.business}';`],
        ["own order items read", `select * from public.order_items where order_id='${own.order}';`],
        ["foreign order items read", `select * from public.order_items where order_id='${other.order}';`],
        ["own dashboard RPC", `select * from public.get_business_dashboard_summary('${own.business}',current_date);`],
        ["foreign dashboard RPC", `select * from public.get_business_dashboard_summary('${other.business}',current_date);`],
        ["own order mutation", `update public.orders set status='preparing' where id='${own.order}';`],
        ["foreign order mutation", `update public.orders set status='preparing' where id='${other.order}';`],
        ["own product mutation", `update public.products set price=999 where id='${own.product}';`],
        ["foreign product PATCH", `update public.products set price=999 where id='${other.product}';`],
        ["foreign product DELETE", `delete from public.products where id='${other.product}';`],
        ["own profile mutation", `update public.businesses set name='Rejected' where id='${own.business}';`],
        ["foreign profile mutation", `update public.businesses set name='Rejected' where id='${other.business}';`],
        ["own reorder", reorderSql(own)], ["foreign reorder", reorderSql(other)],
      ]) await t.test(`${label}: release ACL denies ${name}; full DB state unchanged`, async () => {
        const before = await snapshot();
        const result = await asOwner(own.owner, statement);
        assert.equal(result.failed, true, result.stdout);
        assert.match(result.stderr, /42501/);
        assert.equal(await snapshot(), before, "Every row and updated_at must remain unchanged");
      });
      await t.test(`${label}: order RLS denies rows independently of ACL in rollback-only grant probe`, async () => {
        const before = await snapshot();
        const result = await asOwner(own.owner, "select count(*) from public.orders; select count(*) from public.order_items;",
          "grant select on public.orders, public.order_items to authenticated;");
        assert.equal(result.failed, false, result.stderr);
        assert.equal(result.stdout, "0\n0", "No owner SELECT policy: RLS denies own and foreign orders");
        assert.equal(await snapshot(), before);
        assert.equal(await sql("select has_table_privilege('authenticated','public.orders','select');"), "f");
      });
      await t.test(`${label}: inactive foreign product hidden by actual SELECT RLS`, async () => {
        const result = await asOwner(own.owner, `select count(*) from public.products where id='${other.hiddenProduct}';`);
        assert.equal(result.failed, false, result.stderr);
        assert.equal(result.stdout, "0");
      });
      await t.test(`${label}: dormant product write RLS denies foreign writes even with rollback-only ACL grants`, async () => {
        const before = await snapshot();
        const result = await asOwner(own.owner,
          `with changed as (update public.products set price=999 where id='${other.product}' returning id) select count(*) from changed;
           with removed as (delete from public.products where id='${other.product}' returning id) select count(*) from removed;`,
          "grant update, delete on public.products to authenticated;");
        assert.equal(result.failed, false, result.stderr);
        assert.equal(result.stdout, "0\n0");
        assert.equal(await snapshot(), before);
        assert.equal(await sql("select has_table_privilege('authenticated','public.products','update');"), "f");
      });
      await t.test(`${label}: own product write succeeds under dormant owner RLS in rollback-only probe`, async () => {
        const before = await snapshot();
        const result = await asOwner(own.owner,
          `update public.products set price=999 where id='${own.product}' returning price, updated_at > '2026-01-01'::timestamptz;`,
          "grant update on public.products to authenticated;");
        assert.equal(result.failed, false, result.stderr);
        assert.equal(result.stdout, "999|t");
        assert.equal(await snapshot(), before, "Diagnostic probe must roll back its own write");
      });
      await t.test(`${label}: owner product cannot be reassigned to the other business under rollback-only write grants`, async () => {
        const before = await snapshot();
        const result = await asOwner(own.owner,
          `update public.products set business_id='${other.business}' where id='${own.product}';`,
          "grant update on public.products to authenticated;");
        assert.equal(result.failed, true, result.stdout);
        assert.match(result.stderr, /42501/);
        assert.equal(await snapshot(), before, "Owner WITH CHECK must preserve both accounts");
        assert.equal(await sql("select has_table_privilege('authenticated','public.products','update');"), "f");
      });
      await t.test(`${label}: eligible foreign active catalog is intentionally public`, async () => {
        const result = await asOwner(own.owner, `select id from public.products where business_id='${other.business}' order by id;`);
        assert.equal(result.failed, false, result.stderr);
        assert.equal(result.stdout, publicProductIds(other).sort().join("\n"), "Public catalog contains exactly the foreign active products; inactive products stay hidden");
      });
      for (const [reason, patch] of [
        ["inactive business", "is_active=false"],
        ["inactive subscription", "subscription_status='expired'"],
        ["expired subscription", "subscription_expires_at=now()-interval '1 day'"],
      ]) await t.test(`${label}: ${reason} hides foreign public business and products`, async () => {
        const before = await snapshot();
        const result = await asOwner(own.owner,
          `select count(*) from public.products where business_id='${other.business}';
           select count(*) from public.businesses where id='${other.business}';
           select id from public.products where business_id='${own.business}' order by id;`,
          `update public.businesses set ${patch} where id='${other.business}';`);
        assert.equal(result.failed, false, result.stderr);
        assert.equal(result.stdout, ["0", "0", ...publicProductIds(own).sort()].join("\n"));
        assert.equal(await snapshot(), before, "Catalog eligibility overrides must roll back");
      });
    }
  } finally {
    if (started) await succeeds(["rm", "-f", container]);
  }
});
