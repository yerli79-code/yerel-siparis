import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { computeBufferSha256, computeFileSha256 } from "../../scripts/backup/crypto-util.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { findMissingCriticalArchiveAclEntries } from "../../scripts/backup/database-backup.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { writeManifestAndChecksums } from "../../scripts/backup/manifest.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { defaultArchiveCommand } from "../../scripts/backup/storage-backup.ts";

const RUN_INTEGRATION = process.env.RUN_BACKUP_ARCHIVE_INTEGRATION === "1";
const IMAGE = "supabase/postgres:17.6.1.127";
const IMAGE_ID = "sha256:be60aee15997daca475b710b734bc6bfe52cd544dcd7e9fd2ff58210b6747d83";

function resolveDockerCli(): string {
  if (process.env.DOCKER_CLI) {
    return process.env.DOCKER_CLI;
  }

  const windowsDockerCli = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
  if (process.platform === "win32" && existsSync(windowsDockerCli)) {
    return windowsDockerCli;
  }

  return "docker";
}

function run(
  executable: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

async function waitForStablePostgres(dockerCli: string, containerName: string): Promise<void> {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      await run(dockerCli, ["exec", containerName, "pg_isready", "-U", "postgres", "-d", "postgres"]);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await run(dockerCli, ["exec", containerName, "pg_isready", "-U", "postgres", "-d", "postgres"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error("Disposable PostgreSQL fixture did not become stably ready.");
}

test(
  "database archive integration: PG17 custom dump contains every critical application ACL",
  { skip: !RUN_INTEGRATION, timeout: 120_000 },
  async () => {
    const dockerCli = resolveDockerCli();
    const containerName = `p66b-a3-acl-integration-${process.pid}-${Date.now()}`;
    const localPassword = "local_fixture_only";

    const fixtureSql = `
      create role acl_fixture_reader nologin;
      create table public.orders(id bigint primary key);
      create table public.order_items(id bigint primary key);
      create sequence public.orders_order_number_seq;
      create function public.create_order_with_items(
        text, text, text, text, text, text, jsonb, uuid, text
      ) returns integer language sql as $$ select 1 $$;
      create function public.purge_expired_orders()
      returns integer language sql as $$ select 0 $$;

      revoke all on table public.orders, public.order_items from public;
      grant select on table public.orders, public.order_items to acl_fixture_reader;
      revoke all on sequence public.orders_order_number_seq from public;
      grant usage, select on sequence public.orders_order_number_seq to acl_fixture_reader;
      revoke all on function public.create_order_with_items(
        text, text, text, text, text, text, jsonb, uuid, text
      ) from public;
      grant execute on function public.create_order_with_items(
        text, text, text, text, text, text, jsonb, uuid, text
      ) to acl_fixture_reader;
      revoke all on function public.purge_expired_orders() from public;
      grant execute on function public.purge_expired_orders() to acl_fixture_reader;
    `;

    let containerStarted = false;
    try {
      const image = await run(dockerCli, ["image", "inspect", IMAGE, "--format", "{{.Id}}"]);
      assert.equal(image.stdout.trim(), IMAGE_ID);

      await run(dockerCli, [
        "run",
        "-d",
        "--rm",
        "--name",
        containerName,
        "--network",
        "none",
        "--env",
        `POSTGRES_PASSWORD=${localPassword}`,
        IMAGE,
      ]);
      containerStarted = true;

      const isolation = await run(dockerCli, [
        "inspect",
        containerName,
        "--format",
        "{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Ports}}",
      ]);
      assert.equal(isolation.stdout.trim(), "none|{}|{}");

      await waitForStablePostgres(dockerCli, containerName);

      const pgDumpVersion = await run(dockerCli, ["exec", containerName, "pg_dump", "--version"]);
      const pgRestoreVersion = await run(dockerCli, ["exec", containerName, "pg_restore", "--version"]);
      assert.match(pgDumpVersion.stdout, /PostgreSQL\) 17\./);
      assert.match(pgRestoreVersion.stdout, /PostgreSQL\) 17\./);

      await run(dockerCli, [
        "exec",
        containerName,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-c",
        fixtureSql,
      ]);

      await run(dockerCli, [
        "exec",
        containerName,
        "pg_dump",
        "--format=custom",
        "--file=/tmp/database.dump",
        "--dbname=postgres",
        "--username=postgres",
      ]);

      const toc = await run(dockerCli, [
        "exec",
        containerName,
        "pg_restore",
        "--list",
        "/tmp/database.dump",
      ]);
      assert.deepEqual(findMissingCriticalArchiveAclEntries(toc.stdout), []);

      const schema = await run(dockerCli, [
        "exec",
        containerName,
        "pg_restore",
        "--schema-only",
        "--file=-",
        "/tmp/database.dump",
      ]);
      const normalizedSchema = schema.stdout.replace(/\s+/g, " ");
      assert.match(normalizedSchema, /GRANT SELECT ON TABLE public\.orders TO acl_fixture_reader;/);
      assert.match(normalizedSchema, /GRANT SELECT ON TABLE public\.order_items TO acl_fixture_reader;/);
      assert.match(
        normalizedSchema,
        /GRANT (?:ALL|(?:USAGE,\s*SELECT|SELECT,\s*USAGE)) ON SEQUENCE public\.orders_order_number_seq TO acl_fixture_reader;/,
      );
      assert.match(
        normalizedSchema,
        /GRANT ALL ON FUNCTION public\.create_order_with_items\(text, text, text, text, text, text, jsonb, uuid, text\) TO acl_fixture_reader;/,
      );
      assert.match(
        normalizedSchema,
        /GRANT ALL ON FUNCTION public\.purge_expired_orders\(\) TO acl_fixture_reader;/,
      );
    } finally {
      if (containerStarted) {
        await run(dockerCli, ["rm", "-f", containerName]).catch(() => undefined);
      }
    }
  },
);

test(
  "database restore drill integration: full-fidelity restore into isolated PG17 container passes verify-restore-fidelity.sql",
  { skip: !RUN_INTEGRATION, timeout: 180_000 },
  async () => {
    const dockerCli = resolveDockerCli();
    const containerName = `p66b-a3-restore-drill-${process.pid}-${Date.now()}`;
    const localPassword = "local_restore_drill_pw";

    const setupSql = `
      create extension if not exists pgcrypto schema extensions;
      create extension if not exists pg_cron schema pg_catalog;

      -- Trigger function
      create or replace function public.trigger_set_updated_at()
      returns trigger language plpgsql as $$
      begin
        new.updated_at = now();
        return new;
      end;
      $$;
      alter function public.trigger_set_updated_at() owner to postgres;

      -- Public tables
      create table public.businesses (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table public.businesses owner to postgres;
      alter table public.businesses enable row level security;
      create trigger businesses_set_updated_at before update on public.businesses
        for each row execute function public.trigger_set_updated_at();

      create table public.products (
        id uuid primary key default gen_random_uuid(),
        business_id uuid references public.businesses(id),
        name text not null,
        price numeric not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table public.products owner to postgres;
      alter table public.products enable row level security;
      create trigger products_set_updated_at before update on public.products
        for each row execute function public.trigger_set_updated_at();

      create table public.orders (
        id uuid primary key default gen_random_uuid(),
        business_id uuid references public.businesses(id),
        total_amount numeric not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table public.orders owner to postgres;
      alter table public.orders enable row level security;
      create trigger set_orders_updated_at before update on public.orders
        for each row execute function public.trigger_set_updated_at();

      create table public.order_items (
        id uuid primary key default gen_random_uuid(),
        order_id uuid references public.orders(id),
        product_id uuid references public.products(id),
        quantity int not null,
        created_at timestamptz not null default now()
      );
      alter table public.order_items owner to postgres;
      alter table public.order_items enable row level security;

      create table public.profiles (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table public.profiles owner to postgres;
      alter table public.profiles enable row level security;
      create trigger profiles_set_updated_at before update on public.profiles
        for each row execute function public.trigger_set_updated_at();

      create table public.admin_users (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now()
      );
      alter table public.admin_users owner to postgres;
      alter table public.admin_users enable row level security;

      create table public.admin_audit_logs (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now()
      );
      alter table public.admin_audit_logs owner to postgres;
      alter table public.admin_audit_logs enable row level security;

      create table public.business_order_counters (
        business_id uuid primary key,
        last_order_number int not null default 0
      );
      alter table public.business_order_counters owner to postgres;
      alter table public.business_order_counters enable row level security;

      create table public.public_order_rate_limit_buckets (
        key text primary key,
        tokens int not null,
        last_refill timestamptz not null
      );
      alter table public.public_order_rate_limit_buckets owner to postgres;
      alter table public.public_order_rate_limit_buckets enable row level security;

      create sequence public.orders_order_number_seq;
      alter sequence public.orders_order_number_seq owner to postgres;

      -- Functions
      create or replace function public.create_order_with_items(
        text, text, text, text, text, text, jsonb, uuid, text
      ) returns integer language sql as $$ select 1 $$;
      alter function public.create_order_with_items(text, text, text, text, text, text, jsonb, uuid, text) owner to postgres;

      create or replace function public.purge_expired_orders()
      returns integer security definer language sql as $$ select 0 $$;
      alter function public.purge_expired_orders() owner to postgres;

      -- Permissions on orders & order_items
      revoke all on table public.orders, public.order_items from public;
      revoke all on table public.orders, public.order_items from anon, authenticated;
      grant select, insert, update, delete on table public.orders, public.order_items to service_role;

      -- Sequence permissions
      revoke all on sequence public.orders_order_number_seq from public, anon, authenticated;
      grant usage, select on sequence public.orders_order_number_seq to service_role;

      -- Function permissions
      revoke all on function public.create_order_with_items(text, text, text, text, text, text, jsonb, uuid, text) from public, anon, authenticated;
      grant execute on function public.create_order_with_items(text, text, text, text, text, text, jsonb, uuid, text) to service_role;

      revoke all on function public.purge_expired_orders() from public, anon, authenticated;
      grant execute on function public.purge_expired_orders() to service_role;

      -- Storage schema and tables
      create schema if not exists storage;
      alter schema storage owner to supabase_admin;
      create table if not exists storage.buckets (
        id text primary key,
        name text not null,
        owner uuid,
        created_at timestamptz default now(),
        updated_at timestamptz default now(),
        public boolean default false
      );
      alter table storage.buckets owner to supabase_admin;
      create table if not exists storage.objects (
        id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets(id),
        name text,
        owner uuid,
        created_at timestamptz default now(),
        updated_at timestamptz default now(),
        last_accessed_at timestamptz default now(),
        metadata jsonb
      );
      alter table storage.objects owner to supabase_admin;

      -- Storage schema triggers
      create or replace function storage.storage_dummy_trigger()
      returns trigger language plpgsql as $$ begin return new; end; $$;
      alter function storage.storage_dummy_trigger() owner to supabase_admin;

      create trigger enforce_bucket_name_length_trigger before insert or update on storage.buckets
        for each row execute function storage.storage_dummy_trigger();
      create trigger protect_buckets_delete before delete on storage.buckets
        for each row execute function storage.storage_dummy_trigger();
      create trigger protect_objects_delete before delete on storage.objects
        for each row execute function storage.storage_dummy_trigger();
      create trigger update_objects_updated_at before update on storage.objects
        for each row execute function storage.storage_dummy_trigger();

      -- Cron job
      select cron.schedule('purge_orders_after_180_days', '17 * * * *', 'select public.purge_expired_orders();');

      -- Seed test rows
      insert into public.businesses (name) values ('Fidelity Test Market');
      insert into public.products (business_id, name, price)
        select id, 'Test Item 1', 19.99 from public.businesses limit 1;
      insert into public.orders (business_id, total_amount)
        select id, 19.99 from public.businesses limit 1;
      insert into public.order_items (order_id, product_id, quantity)
        select o.id, p.id, 1 from public.orders o, public.products p limit 1;
    `;

    let containerStarted = false;
    try {
      await run(dockerCli, [
        "run",
        "-d",
        "--rm",
        "--name",
        containerName,
        "--network",
        "none",
        "--env",
        `POSTGRES_PASSWORD=${localPassword}`,
        IMAGE,
      ]);
      containerStarted = true;

      // Verify strict isolation
      const isolation = await run(dockerCli, [
        "inspect",
        containerName,
        "--format",
        "{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .NetworkSettings.Ports}}",
      ]);
      assert.equal(isolation.stdout.trim(), "none|{}|{}");

      await waitForStablePostgres(dockerCli, containerName);

      // Provision schema & data
      await run(dockerCli, [
        "exec",
        containerName,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-c",
        setupSql,
      ]);

      // Dump database using custom format
      await run(dockerCli, [
        "exec",
        containerName,
        "pg_dump",
        "--format=custom",
        "--file=/tmp/database.dump",
        "--dbname=postgres",
        "--username=supabase_admin",
      ]);

      // Verify TOC contains all critical ACLs
      const toc = await run(dockerCli, [
        "exec",
        containerName,
        "pg_restore",
        "--list",
        "/tmp/database.dump",
      ]);
      assert.deepEqual(findMissingCriticalArchiveAclEntries(toc.stdout), []);

      // Clear application objects before restore
      const resetSql = `
        drop schema public cascade;
        create schema public;
        alter schema public owner to postgres;
        grant all on schema public to postgres;
        grant all on schema public to public;
      `;
      await run(dockerCli, [
        "exec",
        containerName,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-c",
        resetSql,
      ]);

      // Execute clean single-transaction restore
      await run(dockerCli, [
        "exec",
        containerName,
        "pg_restore",
        "--clean",
        "--if-exists",
        "--username=supabase_admin",
        "--dbname=postgres",
        "/tmp/database.dump",
      ]);

      // Run verify-restore-fidelity.sql
      const verifySql = readFileSync(
        resolve(process.cwd(), "scripts/backup/verify-restore-fidelity.sql"),
        "utf8",
      );

      const verifyRes = await new Promise<{ stdout: string; stderr: string }>(
        (resolvePromise, rejectPromise) => {
          const child = execFile(
            dockerCli,
            [
              "exec",
              "-i",
              containerName,
              "psql",
              "-X",
              "-v",
              "ON_ERROR_STOP=1",
              "-U",
              "supabase_admin",
              "-d",
              "postgres",
            ],
            { encoding: "utf8" },
            (err, stdout, stderr) => {
              if (err) rejectPromise(err);
              else resolvePromise({ stdout, stderr });
            },
          );
          child.stdin?.write(verifySql);
          child.stdin?.end();
        },
      );

      assert.match(verifyRes.stdout, /RESTORE_FIDELITY_VERIFICATION=PASS/);

      // Verify row counts on restored database
      const countCheck = await run(dockerCli, [
        "exec",
        containerName,
        "psql",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-Atqc",
        "select count(*) from public.businesses; select count(*) from public.products; select count(*) from public.orders; select count(*) from public.order_items;",
      ]);

      const counts = countCheck.stdout.trim().split(/\r?\n/).map(Number);
      assert.deepEqual(counts, [1, 1, 1, 1]);
    } finally {
      if (containerStarted) {
        await run(dockerCli, ["rm", "-f", containerName]).catch(() => undefined);
      }
    }
  },
);

test(
  "storage restore drill integration: archive unpack, recursive paths, and checksum fidelity",
  async () => {
    const tempPrefix = join(tmpdir(), "p66b-storage-drill-");
    const stagingDir = mkdtempSync(tempPrefix);
    const restoreDir = mkdtempSync(join(tmpdir(), "p66b-storage-restore-"));

    try {
      const storageRoot = join(stagingDir, "storage");
      const bucket1 = join(storageRoot, "product-images", "items", "2026");
      const bucket2 = join(storageRoot, "business-logos", "approved");

      mkdirSync(bucket1, { recursive: true });
      mkdirSync(bucket2, { recursive: true });

      const file1Path = join(bucket1, "product_thumb.png");
      const file2Path = join(bucket2, "main_logo.svg");

      const file1Content = Buffer.from("PNG_DATA_FIXTURE_1234567890");
      const file2Content = Buffer.from("<svg>LOGO_DATA_FIXTURE_ABCDEF</svg>");

      writeFileSync(file1Path, file1Content);
      writeFileSync(file2Path, file2Content);

      const file1Sha = computeBufferSha256(file1Content);
      const file2Sha = computeBufferSha256(file2Content);

      // Package storage.tar.gz using system tar
      const archivePath = join(stagingDir, "storage.tar.gz");
      const packResult = await defaultArchiveCommand("tar", [
        "-czf",
        archivePath,
        "-C",
        stagingDir,
        "storage",
      ]);
      assert.equal(packResult.exitCode, 0);
      assert.ok(existsSync(archivePath));

      const archiveSha = await computeFileSha256(archivePath);
      assert.ok(archiveSha.length === 64);

      // Drill Step: Unpack storage.tar.gz into isolated restore directory
      const unpackResult = await defaultArchiveCommand("tar", [
        "-xzf",
        archivePath,
        "-C",
        restoreDir,
      ]);
      assert.equal(unpackResult.exitCode, 0);

      // Verify reconstructed paths and sha256 checksums
      const restoredFile1 = join(restoreDir, "storage", "product-images", "items", "2026", "product_thumb.png");
      const restoredFile2 = join(restoreDir, "storage", "business-logos", "approved", "main_logo.svg");

      assert.ok(existsSync(restoredFile1));
      assert.ok(existsSync(restoredFile2));

      const restored1Sha = await computeFileSha256(restoredFile1);
      const restored2Sha = await computeFileSha256(restoredFile2);

      assert.equal(restored1Sha, file1Sha);
      assert.equal(restored2Sha, file2Sha);
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
      rmSync(restoreDir, { recursive: true, force: true });
    }
  },
);

test("backup artifact bundle integration: manifest.json and SHA256SUMS.txt full verification", async () => {
  const stagingDir = mkdtempSync(join(tmpdir(), "p66b-bundle-drill-"));

  try {
    const dbDumpPath = join(stagingDir, "database.dump");
    const storagePath = join(stagingDir, "storage.tar.gz");

    writeFileSync(dbDumpPath, "MOCK_DB_DUMP_CONTENT");
    writeFileSync(storagePath, "MOCK_STORAGE_ARCHIVE_CONTENT");

    const dbSha = await computeFileSha256(dbDumpPath);
    const storageSha = await computeFileSha256(storagePath);

    const manifestResult = writeManifestAndChecksums({
      stagingDir,
      gitSha: "abc1234567890",
      createdAtUtc: "2026-09-11T20:00:00.000Z",
      database: {
        filename: "database.dump",
        filePath: dbDumpPath,
        bytes: 20,
        sha256: dbSha,
      },
      storage: {
        archiveFilename: "storage.tar.gz",
        archivePath: storagePath,
        archiveBytes: 28,
        archiveSha256: storageSha,
        bucketCount: 2,
        objectCount: 5,
        totalBytes: 500,
        objects: [],
      },
    });

    assert.equal(manifestResult.manifest.formatVersion, 1);
    assert.equal(manifestResult.manifest.database.sha256, dbSha);
    assert.equal(manifestResult.manifest.storage.archiveSha256, storageSha);

    // Verify SHA256SUMS.txt content and integrity
    const sumsContent = readFileSync(manifestResult.sumsPath, "utf8");
    const sumLines = sumsContent.trim().split(/\r?\n/);
    assert.equal(sumLines.length, 3);

    for (const line of sumLines) {
      const [expectedHash, fileName] = line.split(/\s+/);
      const filePath = join(stagingDir, fileName);
      assert.ok(existsSync(filePath));
      const actualHash = await computeFileSha256(filePath);
      assert.equal(actualHash, expectedHash);
    }
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
});

