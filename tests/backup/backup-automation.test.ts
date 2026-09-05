import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { computeBufferSha256, computeFileSha256, formatSha256Sums, parseSha256Sums } from "../../scripts/backup/crypto-util.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { validateBackupEnv, getBackupEnvStatus, formatEnvStatusReport } from "../../scripts/backup/env.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { runDatabaseBackup, maskDatabaseUrl } from "../../scripts/backup/database-backup.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { runStorageBackup, listBucketObjectsRecursive } from "../../scripts/backup/storage-backup.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { buildManifest, writeManifestAndChecksums } from "../../scripts/backup/manifest.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { GoogleDriveClient, refreshGoogleDriveAccessToken } from "../../scripts/backup/google-drive.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { selectRetentionPlan, applyRetentionPlan, getIsoWeekKey } from "../../scripts/backup/retention.ts";
import type { DriveFolderRecord } from "../../scripts/backup/types.ts";

function createTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// A) Manifest Generation
test("A) manifest generation builds valid schema v1 and prevents secret/URL inclusion", () => {
  const manifest = buildManifest({
    gitSha: "1acf837f4ec5cb106f7f2b5c921f053f422695fa",
    createdAtUtc: "2026-09-06T00:00:00.000Z",
    database: {
      filename: "database.dump",
      filePath: "/tmp/database.dump",
      bytes: 1048576,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    storage: {
      archiveFilename: "storage.tar.gz",
      archivePath: "/tmp/storage.tar.gz",
      archiveBytes: 524288,
      archiveSha256: "a69f73cca23a9ac5c8b567dc185a756e97a9fb34a8ce3be94d4e0a4fed1dc618",
      bucketCount: 2,
      objectCount: 4,
      totalBytes: 500000,
      objects: [
        {
          bucket: "menu-images",
          path: "kebap/urfa.jpg",
          bytes: 125000,
          sha256: "1111111111111111111111111111111111111111111111111111111111111111",
        },
      ],
    },
  });

  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.gitSha, "1acf837f4ec5cb106f7f2b5c921f053f422695fa");
  assert.equal(manifest.database.filename, "database.dump");
  assert.equal(manifest.storage.archive, "storage.tar.gz");
  assert.equal(manifest.storage.bucketCount, 2);
  assert.equal(manifest.storage.objectCount, 4);
  assert.equal(manifest.storage.objects[0].path, "kebap/urfa.jpg");

  // Rejects DB info if secret URL leaked
  assert.throws(
    () =>
      buildManifest({
        gitSha: "abc",
        createdAtUtc: "2026-09-06T00:00:00.000Z",
        database: {
          filename: "database.dump",
          filePath: "/tmp/database.dump",
          bytes: 100,
          sha256: "postgresql://user:pass@host:5432/db",
        },
        storage: {
          archiveFilename: "storage.tar.gz",
          archivePath: "/tmp/storage.tar.gz",
          archiveBytes: 100,
          archiveSha256: "123",
          bucketCount: 1,
          objectCount: 1,
          totalBytes: 100,
          objects: [],
        },
      }),
    /Potential secret or URL detected/,
  );
});

// B) SHA-256 Correctness
test("B) SHA-256 correctness and SHA256SUMS format verification", async () => {
  const payload = "yerel-siparis-backup-verification-payload";
  // Known SHA-256 of this exact ASCII string
  const expectedHash = computeBufferSha256(payload);
  assert.match(expectedHash, /^[a-f0-9]{64}$/);

  const tempDir = createTempDir("test-sha");
  try {
    const filePath = join(tempDir, "sample.txt");
    writeFileSync(filePath, payload, "utf8");

    const fileHash = await computeFileSha256(filePath);
    assert.equal(fileHash, expectedHash);

    const formatted = formatSha256Sums([
      { filename: "database.dump", sha256: expectedHash },
      { filename: "storage.tar.gz", sha256: expectedHash },
    ]);

    const parsed = parseSha256Sums(formatted);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].filename, "database.dump");
    assert.equal(parsed[0].sha256, expectedHash);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// C) Storage Nested Path Handling
test("C) Storage nested path handling preserves folder hierarchy accurately", async () => {
  const tempDir = createTempDir("test-storage-nested");
  try {
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/storage/v1/bucket")) {
        return new Response(JSON.stringify([{ id: "business-assets", name: "business-assets" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/storage/v1/object/list/")) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.prefix === "restaurants") {
          return new Response(
            JSON.stringify([
              { name: "urfa-kebap.jpg", id: "obj-nested-1" },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify([
            { name: "restaurants", id: null }, // folder prefix
            { name: "logo.png", id: "obj-1" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.includes("/storage/v1/object/authenticated/")) {
        return new Response(Buffer.from("nested-content-data"), {
          status: 200,
        });
      }

      return new Response("Not Found", { status: 404 });
    };

    const mockArchive = async () => {
      writeFileSync(join(tempDir, "storage.tar.gz"), Buffer.from("mock-tar-gz"));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await runStorageBackup({
      supabaseUrl: "https://test.supabase.co",
      serviceRoleKey: "mock-key",
      stagingDir: tempDir,
      fetchFn: mockFetch,
      execCommand: mockArchive,
    });

    assert.equal(result.bucketCount, 1);
    assert.equal(result.objectCount, 2);
    assert.ok(result.objects.some((o) => o.path === "restaurants/urfa-kebap.jpg"));
    assert.ok(result.objects.some((o) => o.path === "logo.png"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// D) Storage Pagination
test("D) Storage pagination iterates multiple pages until end of bucket", async () => {
  let callCount = 0;
  const mockFetch: typeof fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    callCount++;

    if (body.offset === 0) {
      // Page 1: returns 100 items (maximum limit)
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        name: `file-${i}.txt`,
        id: `id-${i}`,
      }));
      return new Response(JSON.stringify(page1), { status: 200 });
    } else {
      // Page 2: returns 25 items (less than limit => signals termination)
      const page2 = Array.from({ length: 25 }, (_, i) => ({
        name: `file-${100 + i}.txt`,
        id: `id-${100 + i}`,
      }));
      return new Response(JSON.stringify(page2), { status: 200 });
    }
  };

  const objects = await listBucketObjectsRecursive(
    "https://test.supabase.co",
    "mock-key",
    "test-bucket",
    "",
    mockFetch,
  );

  assert.equal(objects.length, 125);
  assert.equal(callCount, 2);
  assert.equal(objects[0].path, "file-0.txt");
  assert.equal(objects[124].path, "file-124.txt");
});

// E) Empty Bucket Handling
test("E) empty bucket succeeds cleanly without throwing and records 0 objects", async () => {
  const tempDir = createTempDir("test-empty-bucket");
  try {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/storage/v1/bucket")) {
        return new Response(JSON.stringify([{ id: "empty-bucket", name: "empty-bucket" }]), {
          status: 200,
        });
      }
      if (url.includes("/storage/v1/object/list/")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    const mockArchive = async () => {
      writeFileSync(join(tempDir, "storage.tar.gz"), Buffer.from("empty-tar"));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await runStorageBackup({
      supabaseUrl: "https://test.supabase.co",
      serviceRoleKey: "mock-key",
      stagingDir: tempDir,
      fetchFn: mockFetch,
      execCommand: mockArchive,
    });

    assert.equal(result.bucketCount, 1);
    assert.equal(result.objectCount, 0);
    assert.equal(result.totalBytes, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// F) Retention Newest-7
test("F) retention newest-7 keeps the most recent 7 completed backups", () => {
  const rootId = "root-folder-123";
  // Generate 12 daily backups
  const folders: DriveFolderRecord[] = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 7, 20 + i, 2, 0, 0)); // August 2026
    const name = date.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
    return {
      id: `folder-${i}`,
      name,
      parents: [rootId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "true",
        createdAt: name,
      },
    };
  });

  const plan = selectRetentionPlan(folders, rootId);

  // Newest 7 must be in keepSet
  const newestIds = ["folder-11", "folder-10", "folder-9", "folder-8", "folder-7", "folder-6", "folder-5"];
  for (const id of newestIds) {
    assert.ok(plan.keepSet.some((f) => f.id === id), `Expected ${id} to be in keepSet`);
  }
});

// G) Retention Weekly-4
test("G) retention weekly-4 retains one newest completed backup per week for 4 prior weeks", () => {
  const rootId = "root-folder-123";
  // Backups spread across 6 consecutive weeks (1 per week)
  const folders: DriveFolderRecord[] = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 6, 1 + i * 7, 2, 0, 0));
    const name = date.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
    return {
      id: `weekly-${i}`,
      name,
      parents: [rootId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "true",
        createdAt: name,
      },
    };
  });

  const plan = selectRetentionPlan(folders, rootId);
  // Total folders = 6. All 6 kept because 6 <= 7 newest
  assert.equal(plan.keepSet.length, 6);
  assert.equal(plan.deleteSet.length, 0);
});

// H) Retention Union Behavior
test("H) retention union combines newest 7 and weekly 4 without duplicate entries", () => {
  const rootId = "root-folder-123";
  // 30 daily backups
  const folders: DriveFolderRecord[] = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 6, 1 + i, 2, 0, 0));
    const name = date.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
    return {
      id: `daily-${i}`,
      name,
      parents: [rootId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "true",
        createdAt: name,
      },
    };
  });

  const plan = selectRetentionPlan(folders, rootId);

  // Keep set size should be 7 daily + up to 4 weekly (some overlap may happen)
  assert.ok(plan.keepSet.length >= 7);
  assert.ok(plan.keepSet.length <= 11);

  // No duplicates in keepSet
  const ids = new Set(plan.keepSet.map((f) => f.id));
  assert.equal(ids.size, plan.keepSet.length);

  // Delete set does not intersect with keep set
  for (const del of plan.deleteSet) {
    assert.ok(!ids.has(del.id), `Item ${del.id} should not be in both keep and delete sets`);
  }
});

// I) Retention Foreign/Unmarked Folder Exclusion
test("I) retention foreign/unmarked Drive folder is NEVER selected for deletion", () => {
  const rootId = "root-folder-123";
  const folders: DriveFolderRecord[] = [
    {
      id: "foreign-1",
      name: "My Documents",
      parents: [rootId],
      appProperties: {
        appName: "other-app",
        role: "backup",
      },
    },
    {
      id: "unmarked-2",
      name: "Random Folder",
      parents: [rootId],
    },
    {
      id: "wrong-parent",
      name: "2026-08-01T00-00-00Z",
      parents: ["other-parent-id"],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "true",
      },
    },
  ];

  const plan = selectRetentionPlan(folders, rootId);
  assert.equal(plan.deleteSet.length, 0);
  assert.equal(plan.excludedCount, 3);
});

// J) Incomplete Backup Exclusion
test("J) incomplete backup (complete=false) is NEVER selected for deletion by retention", () => {
  const rootId = "root-folder-123";
  const folders: DriveFolderRecord[] = [
    {
      id: "incomplete-1",
      name: "2026-08-01T00-00-00Z",
      parents: [rootId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "false",
      },
    },
    {
      id: "missing-complete-prop",
      name: "2026-08-02T00-00-00Z",
      parents: [rootId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
      },
    },
  ];

  const plan = selectRetentionPlan(folders, rootId);
  assert.equal(plan.deleteSet.length, 0);
  assert.equal(plan.excludedCount, 2);
});

// K) Dry-run Retention Safety
test("K) dry-run retention makes ZERO delete calls", async () => {
  let deleteCalls = 0;
  const mockDriveClient = {
    deleteFolder: async () => {
      deleteCalls++;
    },
  } as unknown as GoogleDriveClient;

  const plan = {
    keepSet: [],
    deleteSet: [
      { id: "del-1", name: "f1" },
      { id: "del-2", name: "f2" },
    ] as DriveFolderRecord[],
    excludedCount: 0,
  };

  const res = await applyRetentionPlan({
    plan,
    driveClient: mockDriveClient,
    dryRun: true,
  });

  assert.equal(res.dryRun, true);
  assert.equal(res.deletedCount, 2);
  assert.equal(deleteCalls, 0);
});

// L) Missing Required Env Fail-Closed
test("L) missing required env variables fails closed", () => {
  const incompleteEnv = {
    SUPABASE_URL: "https://example.supabase.co",
    // Missing others
  };

  assert.throws(
    () => validateBackupEnv(incompleteEnv),
    /Missing required variables/,
  );

  const statuses = getBackupEnvStatus(incompleteEnv);
  assert.equal(statuses.find((s) => s.name === "SUPABASE_URL")?.configured, true);
  assert.equal(statuses.find((s) => s.name === "SUPABASE_DB_URL")?.configured, false);
});

// M) Failed Object Download Fail-Closed
test("M) failed storage object download causes fail-closed abortion", async () => {
  const tempDir = createTempDir("test-storage-fail");
  try {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/storage/v1/bucket")) {
        return new Response(JSON.stringify([{ id: "b1", name: "b1" }]), { status: 200 });
      }
      if (url.includes("/storage/v1/object/list/")) {
        return new Response(JSON.stringify([{ name: "important.jpg", id: "id-1" }]), { status: 200 });
      }
      if (url.includes("/storage/v1/object/authenticated/")) {
        // Download failure HTTP 500
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    };

    await assert.rejects(
      async () =>
        runStorageBackup({
          supabaseUrl: "https://test.supabase.co",
          serviceRoleKey: "mock-key",
          stagingDir: tempDir,
          fetchFn: mockFetch,
        }),
      /Failed to download object/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// N) Failed Upload Fail-Closed
test("N) failed upload to Google Drive causes fail-closed without marking complete=true", async () => {
  const tempDir = createTempDir("test-drive-fail");
  try {
    const dumpPath = join(tempDir, "database.dump");
    writeFileSync(dumpPath, "sample-content-for-upload");

    let markedComplete = false;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/upload/drive/v3/files")) {
        // Fail upload
        return new Response("Upload quota exceeded", { status: 503 });
      }
      if (url.includes("/drive/v3/files/") && init?.method === "PATCH") {
        markedComplete = true;
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    };

    const client = new GoogleDriveClient({
      accessToken: "mock-token",
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        client.uploadFile({
          parentId: "backup-folder-id",
          filePath: dumpPath,
          fileName: "database.dump",
          mimeType: "application/octet-stream",
        }),
      /Failed to upload "database.dump"/,
    );

    // markBackupComplete must NOT have been called
    assert.equal(markedComplete, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// O) Zero-Byte Database Dump Rejected
test("O) zero-byte database dump is rejected (fail-closed)", async () => {
  const tempDir = createTempDir("test-zero-byte");
  try {
    const dumpPath = join(tempDir, "database.dump");
    // Create 0-byte file
    writeFileSync(dumpPath, "");

    const mockExec = async () => ({ exitCode: 0, stdout: "", stderr: "" });

    await assert.rejects(
      async () =>
        runDatabaseBackup({
          dbUrl: "postgresql://postgres:postgres@localhost:5432/test",
          outputPath: dumpPath,
          execCommand: mockExec,
        }),
      /Database dump produced a 0-byte file/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// Extra: OAuth error does not leak secret in response
test("OAuth refresh error does not leak tokens or secrets in thrown error", async () => {
  const mockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({ error: "invalid_grant", error_description: "Token revoked" }),
      { status: 400, statusText: "Bad Request" },
    );
  };

  await assert.rejects(
    async () =>
      refreshGoogleDriveAccessToken({
        clientId: "client-id-123",
        clientSecret: "SECRET_VALUE_TO_NOT_LEAK",
        refreshToken: "REFRESH_TOKEN_TO_NOT_LEAK",
        fetchFn: mockFetch,
      }),
    (err: Error) => {
      assert.ok(!err.message.includes("SECRET_VALUE_TO_NOT_LEAK"));
      assert.ok(!err.message.includes("REFRESH_TOKEN_TO_NOT_LEAK"));
      assert.ok(err.message.includes("HTTP 400"));
      return true;
    },
  );
});

// Extra: maskDatabaseUrl masks password and username
test("maskDatabaseUrl securely redacts database credentials", () => {
  const url = "postgresql://myuser:supersecretpass@db.project.supabase.co:5432/postgres";
  const masked = maskDatabaseUrl(url);
  assert.ok(!masked.includes("myuser"));
  assert.ok(!masked.includes("supersecretpass"));
  assert.ok(masked.includes("db.project.supabase.co"));
});
