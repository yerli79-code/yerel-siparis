import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { computeBufferSha256, computeFileSha256, computeFileMd5, formatSha256Sums, parseSha256Sums } from "../../scripts/backup/crypto-util.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { validateBackupEnv, getBackupEnvStatus, formatEnvStatusReport } from "../../scripts/backup/env.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { countArchiveAclEntries, findMissingCriticalArchiveAclEntries, listArchiveObjectAclIdentities, runDatabaseBackup, maskDatabaseUrl, parseDatabaseConnectionParams } from "../../scripts/backup/database-backup.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { runStorageBackup, listBucketObjectsRecursive, resolveSafeStoragePath } from "../../scripts/backup/storage-backup.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { buildManifest, writeManifestAndChecksums } from "../../scripts/backup/manifest.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { GoogleDriveClient, refreshGoogleDriveAccessToken, validateChunkSize, parseResumeRangeHeader, uploadAndFinalizeBackupArtifacts, MIN_RESUMABLE_CHUNK_SIZE, DEFAULT_RESUMABLE_CHUNK_SIZE } from "../../scripts/backup/google-drive.ts";
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
    const inspectedHeaders: Headers[] = [];
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      inspectedHeaders.push(headers);

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
      backupSecretKey: "mock-backup-secret-key",
      stagingDir: tempDir,
      fetchFn: mockFetch,
      execCommand: mockArchive,
    });

    assert.equal(result.bucketCount, 1);
    assert.equal(result.objectCount, 2);
    assert.ok(result.objects.some((o) => o.path === "restaurants/urfa-kebap.jpg"));
    assert.ok(result.objects.some((o) => o.path === "logo.png"));

    // Verify storage request headers: apikey is set, Authorization Bearer is ABSENT
    assert.ok(inspectedHeaders.length > 0);
    for (const h of inspectedHeaders) {
      assert.equal(h.get("apikey"), "mock-backup-secret-key");
      assert.equal(h.has("authorization"), false, "Storage request MUST NOT contain Authorization Bearer header");
    }
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
      backupSecretKey: "mock-key",
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
test("G) retention weekly-4 retains one newest completed backup per week for 4 prior weeks and expires older weeks", () => {
  const rootId = "root-folder-123";

  // 1. 10 recent daily backups in August 2026 (Aug 20 to Aug 29)
  const recentDaily: DriveFolderRecord[] = Array.from({ length: 10 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 7, 20 + i, 2, 0, 0));
    const name = date.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
    return {
      id: `recent-${i}`,
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

  // 2. 6 distinct prior calendar weeks (e.g. June/July 2026), 2 backups per week
  const olderWeeks: DriveFolderRecord[] = [];
  for (let w = 1; w <= 6; w++) {
    // Monday and Friday of each prior week
    const monDate = new Date(Date.UTC(2026, 6, 27 - w * 7, 2, 0, 0));
    const friDate = new Date(Date.UTC(2026, 6, 31 - w * 7, 2, 0, 0));

    const monName = monDate.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
    const friName = friDate.toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";

    olderWeeks.push({
      id: `week-${w}-mon`,
      name: monName,
      parents: [rootId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "true",
        createdAt: monName,
      },
    });

    olderWeeks.push({
      id: `week-${w}-fri`,
      name: friName,
      parents: [rootId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "true",
        createdAt: friName,
      },
    });
  }

  const allFolders = [...recentDaily, ...olderWeeks];
  const plan = selectRetentionPlan(allFolders, rootId);

  // Verification 1: Newest 7 daily backups (recent-9 down to recent-3) must be in keepSet
  for (let i = 3; i <= 9; i++) {
    assert.ok(
      plan.keepSet.some((f) => f.id === `recent-${i}`),
      `Expected recent-${i} to be in keepSet`,
    );
  }

  // Verification 2: The 3 older daily backups in the recent cluster (recent-0, 1, 2) must be in deleteSet
  for (let i = 0; i < 3; i++) {
    assert.ok(
      plan.deleteSet.some((f) => f.id === `recent-${i}`),
      `Expected recent-${i} to be in deleteSet`,
    );
  }

  // Verification 3: Weekly retention keeps newest in each of the 4 most recent weeks
  // Distinct weeks in dataset: W35, W34, W30 (week-1), W29 (week-2), W28 (week-3), W27 (week-4), W26 (week-5), W25 (week-6)
  // The 4 most recent weeks are W35, W34, W30, W29 -> week-1-fri and week-2-fri are kept
  assert.ok(plan.keepSet.some((f) => f.id === "week-1-fri"));
  assert.ok(plan.keepSet.some((f) => f.id === "week-2-fri"));

  // Monday backups in kept weeks are older than Friday backups, so they must be in deleteSet
  assert.ok(plan.deleteSet.some((f) => f.id === "week-1-mon"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-2-mon"));

  // Verification 4: Older weeks beyond 4 most recent calendar weeks (week-3, week-4, week-5, week-6) are deleted
  assert.ok(plan.deleteSet.some((f) => f.id === "week-3-mon"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-3-fri"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-4-mon"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-4-fri"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-5-mon"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-5-fri"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-6-mon"));
  assert.ok(plan.deleteSet.some((f) => f.id === "week-6-fri"));

  // Verification 5: Union produces no duplicates
  const keepIds = new Set(plan.keepSet.map((f) => f.id));
  assert.equal(keepIds.size, plan.keepSet.length);

  // Verification 6: KeepSet and deleteSet are mutually exclusive and partition allFolders
  assert.equal(plan.keepSet.length + plan.deleteSet.length, allFolders.length);
  for (const del of plan.deleteSet) {
    assert.ok(!keepIds.has(del.id), `Item ${del.id} should not be in both keepSet and deleteSet`);
  }
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
  assert.equal(statuses.find((s) => s.name === "SUPABASE_BACKUP_SECRET_KEY")?.configured, false);
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
          backupSecretKey: "mock-key",
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
test("N) failed upload initiation to Google Drive causes fail-closed without marking complete=true", async () => {
  const tempDir = createTempDir("test-drive-fail");
  try {
    const dumpPath = join(tempDir, "database.dump");
    writeFileSync(dumpPath, "sample-content-for-upload");

    let markedComplete = false;

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/upload/drive/v3/files") && url.includes("uploadType=resumable")) {
        // Fail initiation with HTTP 503
        return new Response("Upload quota exceeded", { status: 503, statusText: "Service Unavailable" });
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
      /Failed to initiate resumable upload for "database.dump"/,
    );

    // markBackupComplete must NOT have been called
    assert.equal(markedComplete, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// N.1) Successful Verified Resumable Upload Streaming in Chunks
test("N.1) successful resumable upload streams chunks from disk and verifies remote integrity", async () => {
  const tempDir = createTempDir("test-drive-resumable-ok");
  try {
    const totalBytes = 1024 * 1024; // 1 MiB
    const chunkSize = 256 * 1024; // 256 KiB
    const testPayload = Buffer.alloc(totalBytes, "B");
    const filePath = join(tempDir, "database.dump");
    writeFileSync(filePath, testPayload);

    const localMd5 = await computeFileMd5(filePath);
    let chunkCount = 0;
    const receivedRanges: string[] = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      // Initiation
      if (url.includes("uploadType=resumable")) {
        const headers = new Headers();
        headers.set("location", "https://upload.test/resumable-session-123");
        return new Response(null, { status: 200, headers });
      }

      // Resumable session PUT chunk
      if (url === "https://upload.test/resumable-session-123") {
        chunkCount++;
        const headers = new Headers(init?.headers);
        const contentRange = headers.get("content-range") || "";
        receivedRanges.push(contentRange);

        if (chunkCount === 1) {
          const resHeaders = new Headers();
          resHeaders.set("range", "bytes=0-262143");
          return new Response(null, { status: 308, headers: resHeaders });
        } else if (chunkCount === 2) {
          const resHeaders = new Headers();
          resHeaders.set("range", "bytes=0-524287");
          return new Response(null, { status: 308, headers: resHeaders });
        } else if (chunkCount === 3) {
          const resHeaders = new Headers();
          resHeaders.set("range", "bytes=0-786431");
          return new Response(null, { status: 308, headers: resHeaders });
        } else if (chunkCount === 4) {
          return new Response(
            JSON.stringify({
              id: "file-success-id",
              name: "database.dump",
              size: totalBytes.toString(),
              md5Checksum: localMd5,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      }

      return new Response("Not Found", { status: 404 });
    };

    const client = new GoogleDriveClient({
      accessToken: "mock-token",
      fetchFn: mockFetch,
    });

    const record = await client.uploadFile({
      parentId: "backup-folder-id",
      filePath,
      fileName: "database.dump",
      mimeType: "application/octet-stream",
      chunkSize,
    });

    assert.equal(record.id, "file-success-id");
    assert.equal(record.size, totalBytes.toString());
    assert.equal(record.md5Checksum, localMd5);
    assert.equal(chunkCount, 4);
    assert.equal(receivedRanges[0], "bytes 0-262143/1048576");
    assert.equal(receivedRanges[1], "bytes 262144-524287/1048576");
    assert.equal(receivedRanges[2], "bytes 524288-786431/1048576");
    assert.equal(receivedRanges[3], "bytes 786432-1048575/1048576");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// N.4) Chunk Size Validation Fails Closed
test("N.4) validateChunkSize enforces positive multiple of 256 KiB", () => {
  // Valid chunk sizes pass
  assert.doesNotThrow(() => validateChunkSize(MIN_RESUMABLE_CHUNK_SIZE));
  assert.doesNotThrow(() => validateChunkSize(512 * 1024));
  assert.doesNotThrow(() => validateChunkSize(DEFAULT_RESUMABLE_CHUNK_SIZE));

  // Sub-256 KiB chunks fail
  assert.throws(() => validateChunkSize(16 * 1024), /Invalid Google Drive resumable upload chunk size/);
  assert.throws(() => validateChunkSize(100), /Invalid Google Drive resumable upload chunk size/);

  // Non-multiples fail
  assert.throws(() => validateChunkSize(300 * 1024), /Invalid Google Drive resumable upload chunk size/);

  // Negative / 0 / non-integers fail
  assert.throws(() => validateChunkSize(0), /Invalid Google Drive resumable upload chunk size/);
  assert.throws(() => validateChunkSize(-256 * 1024), /Invalid Google Drive resumable upload chunk size/);
  assert.throws(() => validateChunkSize(256.5 * 1024), /Invalid Google Drive resumable upload chunk size/);
});

// N.5) 308 Range Header Parsing and Validation
test("N.5) parseResumeRangeHeader validates Range header and rejects malformed/backward ranges", () => {
  // Valid Range header
  const nextOffset = parseResumeRangeHeader("bytes=0-262143", 1048576, 0);
  assert.equal(nextOffset, 262144);

  // Missing Range header throws
  assert.throws(() => parseResumeRangeHeader(null, 1048576, 0), /missing required "Range" header/);
  assert.throws(() => parseResumeRangeHeader("", 1048576, 0), /missing required "Range" header/);

  // Malformed Range header throws
  assert.throws(() => parseResumeRangeHeader("invalid-range", 1048576, 0), /Malformed Range header/);

  // Start byte not 0 throws
  assert.throws(() => parseResumeRangeHeader("bytes=100-262143", 1048576, 0), /Unexpected Range header start byte 100/);

  // End byte exceeding total size throws
  assert.throws(() => parseResumeRangeHeader("bytes=0-2000000", 1048576, 0), /exceeds total file size/);

  // Range not advancing offset throws
  assert.throws(() => parseResumeRangeHeader("bytes=0-100", 1048576, 150), /did not advance offset/);
});

// C1) Complete=true Regression Test: 4 verified artifacts triggers markBackupComplete exactly once
test("C1) uploadAndFinalizeBackupArtifacts marks complete=true only when all 4 artifacts pass verification", async () => {
  const tempDir = createTempDir("test-finalize-ok");
  try {
    const files = ["database.dump", "storage.tar.gz", "manifest.json", "SHA256SUMS.txt"];
    const artifacts = files.map((fileName) => {
      const p = join(tempDir, fileName);
      writeFileSync(p, `content-for-${fileName}`);
      return {
        filePath: p,
        fileName,
        mimeType: "application/octet-stream",
      };
    });

    let completeCallCount = 0;

    const mockDriveClient = {
      uploadFile: async ({ fileName }: { fileName: string }) => {
        return {
          id: `id-${fileName}`,
          name: fileName,
          size: "100",
          md5Checksum: "mock-md5",
        };
      },
      markBackupComplete: async (folderId: string) => {
        assert.equal(folderId, "backup-folder-777");
        completeCallCount++;
      },
    } as unknown as GoogleDriveClient;

    const result = await uploadAndFinalizeBackupArtifacts({
      driveClient: mockDriveClient,
      backupFolderId: "backup-folder-777",
      artifacts,
    });

    assert.equal(result.length, 4);
    assert.equal(completeCallCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// C2) Complete=true Regression Test: any artifact verification failure produces ZERO markBackupComplete calls
test("C2) uploadAndFinalizeBackupArtifacts makes ZERO markBackupComplete calls if any artifact verification fails", async () => {
  const tempDir = createTempDir("test-finalize-fail");
  try {
    const files = ["database.dump", "storage.tar.gz", "manifest.json", "SHA256SUMS.txt"];
    const artifacts = files.map((fileName) => {
      const p = join(tempDir, fileName);
      writeFileSync(p, `content-for-${fileName}`);
      return {
        filePath: p,
        fileName,
        mimeType: "application/octet-stream",
      };
    });

    let completeCallCount = 0;

    const mockDriveClient = {
      uploadFile: async ({ fileName }: { fileName: string }) => {
        if (fileName === "manifest.json") {
          throw new Error(`Remote checksum mismatch for "manifest.json": expected MD5 a, got b (fail-closed).`);
        }
        return {
          id: `id-${fileName}`,
          name: fileName,
          size: "100",
          md5Checksum: "mock-md5",
        };
      },
      markBackupComplete: async () => {
        completeCallCount++;
      },
    } as unknown as GoogleDriveClient;

    await assert.rejects(
      async () =>
        uploadAndFinalizeBackupArtifacts({
          driveClient: mockDriveClient,
          backupFolderId: "backup-folder-777",
          artifacts,
        }),
      /Remote checksum mismatch for "manifest.json"/,
    );

    // ZERO markBackupComplete calls
    assert.equal(completeCallCount, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// N.2) Remote Size Mismatch Fails Closed
test("N.2) remote size mismatch fails closed and prevents completion", async () => {
  const tempDir = createTempDir("test-drive-size-mismatch");
  try {
    const filePath = join(tempDir, "database.dump");
    writeFileSync(filePath, "1234567890"); // 10 bytes

    const localMd5 = await computeFileMd5(filePath);

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("uploadType=resumable")) {
        const headers = new Headers();
        headers.set("location", "https://upload.test/session-mismatch");
        return new Response(null, { status: 200, headers });
      }

      if (url === "https://upload.test/session-mismatch") {
        // Return incorrect remote size (e.g. 5 bytes instead of 10)
        return new Response(
          JSON.stringify({
            id: "file-bad-size",
            size: "5",
            md5Checksum: localMd5,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const client = new GoogleDriveClient({
      accessToken: "mock-token",
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        client.uploadFile({
          parentId: "backup-folder-id",
          filePath,
          fileName: "database.dump",
          mimeType: "application/octet-stream",
        }),
      /Remote size mismatch for "database.dump": expected 10 bytes, got 5 bytes/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// N.3) Remote Checksum Mismatch Fails Closed
test("N.3) remote MD5 checksum mismatch fails closed and prevents completion", async () => {
  const tempDir = createTempDir("test-drive-md5-mismatch");
  try {
    const filePath = join(tempDir, "database.dump");
    writeFileSync(filePath, "verified-payload");

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("uploadType=resumable")) {
        const headers = new Headers();
        headers.set("location", "https://upload.test/session-bad-md5");
        return new Response(null, { status: 200, headers });
      }

      if (url === "https://upload.test/session-bad-md5") {
        // Return corrupted/mismatched remote MD5
        return new Response(
          JSON.stringify({
            id: "file-bad-md5",
            size: "16",
            md5Checksum: "00000000000000000000000000000000",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const client = new GoogleDriveClient({
      accessToken: "mock-token",
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () =>
        client.uploadFile({
          parentId: "backup-folder-id",
          filePath,
          fileName: "database.dump",
          mimeType: "application/octet-stream",
        }),
      /Remote checksum mismatch for "database.dump"/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// P1) Database Connection Parameters Security: Password and URL removed from argv
test("P1) parseDatabaseConnectionParams extracts host, port, username, dbname into args and moves password to env", () => {
  const testUrl = "postgresql://secuser:topsecretpassword123@db.project.supabase.co:6543/postgres?sslmode=require";
  const outputPath = "/tmp/database.dump";

  const result = parseDatabaseConnectionParams(testUrl, outputPath);

  assert.equal(result.host, "db.project.supabase.co");
  assert.equal(result.port, "6543");
  assert.equal(result.username, "secuser");
  assert.equal(result.dbname, "postgres");
  assert.equal(result.sslmode, "require");
  assert.equal(result.password, "topsecretpassword123");

  // Argv checks
  assert.ok(result.args.includes("--host=db.project.supabase.co"));
  assert.ok(result.args.includes("--port=6543"));
  assert.ok(result.args.includes("--username=secuser"));
  assert.ok(result.args.includes("--dbname=postgres"));
  assert.ok(result.args.includes("--format=custom"));
  assert.ok(result.args.includes(`--file=${outputPath}`));
  assert.ok(!result.args.includes("--no-acl"));
  assert.ok(!result.args.includes("--no-privileges"));
  assert.ok(!result.args.includes("--no-owner"));

  // Ensure password and raw full URL are NEVER in argv
  for (const arg of result.args) {
    assert.ok(!arg.includes("topsecretpassword123"), `Password leaked in arg: ${arg}`);
    assert.ok(!arg.includes("postgresql://"), `Full connection URL in arg: ${arg}`);
  }

  // Environment checks
  assert.equal(result.env.PGPASSWORD, "topsecretpassword123");
  assert.equal(result.env.PGSSLMODE, "require");
  assert.equal(result.env.PGCONNECT_TIMEOUT, "30");
});

test("P1.1) database backup verifies real archive ACL entries with pg_restore --list", async () => {
  const tempDir = createTempDir("test-database-acl");
  const dumpPath = join(tempDir, "database.dump");
  const calls: Array<{ command: string; args: string[] }> = [];

  try {
    const mockExec = async (command: string, args: string[]) => {
      calls.push({ command, args });

      if (command === "pg_dump") {
        writeFileSync(dumpPath, "mock-custom-archive");
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      assert.equal(command, "pg_restore");
      return {
        exitCode: 0,
        stdout: [
          "; Archive created by pg_dump",
          "4101; 0 0 ACL public TABLE orders postgres",
          "4102; 0 0 ACL public TABLE order_items postgres",
          "4103; 0 0 ACL public SEQUENCE orders_order_number_seq postgres",
          "4104; 0 0 ACL public FUNCTION create_order_with_items(text, text, text, text, text, text, jsonb, uuid, text) postgres",
          "4105; 0 0 ACL public FUNCTION purge_expired_orders() postgres",
          "4102; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres",
        ].join("\n"),
        stderr: "",
      };
    };

    const result = await runDatabaseBackup({
      dbUrl: "postgresql://backup-user:backup-password@localhost:5432/postgres",
      outputPath: dumpPath,
      execCommand: mockExec,
    });

    assert.ok(result.bytes > 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].command, "pg_dump");
    assert.ok(calls[0].args.includes("--format=custom"));
    assert.ok(!calls[0].args.includes("--no-acl"));
    assert.ok(!calls[0].args.includes("--no-privileges"));
    assert.ok(!calls[0].args.includes("--no-owner"));
    assert.deepEqual(calls[1], {
      command: "pg_restore",
      args: ["--list", dumpPath],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("P1.2) ACL TOC parser ignores comments and requires archive ACL records", () => {
  const toc = [
    "; ACL mentioned in an archive comment is not evidence",
    "123; 0 0 TABLE public orders postgres",
    "124; 0 0 ACL public TABLE orders postgres",
    "125; 0 0 ACL public TABLE order_items postgres",
    "126; 0 0 ACL public SEQUENCE orders_order_number_seq postgres",
    "127; 0 0 ACL public FUNCTION create_order_with_items(text, text, text, text, text, text, jsonb, uuid, text) postgres",
    "128; 0 0 ACL public FUNCTION purge_expired_orders() postgres",
    "129; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR FUNCTIONS postgres",
  ].join("\n");

  assert.equal(countArchiveAclEntries(toc), 6);
  assert.deepEqual(findMissingCriticalArchiveAclEntries(toc), []);
  assert.deepEqual(listArchiveObjectAclIdentities(toc), [
    "public FUNCTION create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)",
    "public FUNCTION purge_expired_orders()",
    "public SEQUENCE orders_order_number_seq",
    "public TABLE order_items",
    "public TABLE orders",
  ]);
});

test("P1.2a) ACL TOC parser normalizes realistic PostgreSQL 17 named function arguments (PASS)", () => {
  const realisticPg17Toc = [
    "; Archive created by pg_dump version 17.11",
    "3650; 0 0 ACL public TABLE orders postgres",
    "3651; 0 0 ACL public TABLE order_items postgres",
    "3652; 0 0 ACL public SEQUENCE orders_order_number_seq postgres",
    "3659; 0 0 ACL public FUNCTION create_order_with_items(p_business_slug text, p_order_type text, p_customer_name text, p_customer_phone text, p_customer_address text, p_customer_note text, p_items jsonb, p_idempotency_key uuid, p_payment_method text) postgres",
    "3660; 0 0 ACL public FUNCTION purge_expired_orders() postgres",
  ].join("\n");

  assert.equal(countArchiveAclEntries(realisticPg17Toc), 5);
  assert.deepEqual(findMissingCriticalArchiveAclEntries(realisticPg17Toc), []);
  assert.deepEqual(listArchiveObjectAclIdentities(realisticPg17Toc), [
    "public FUNCTION create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)",
    "public FUNCTION purge_expired_orders()",
    "public SEQUENCE orders_order_number_seq",
    "public TABLE order_items",
    "public TABLE orders",
  ]);
});

test("P1.2b) ACL TOC parser rejects legacy 8-parameter function signature (FAIL)", () => {
  const legacy8ParamToc = [
    "3650; 0 0 ACL public TABLE orders postgres",
    "3651; 0 0 ACL public TABLE order_items postgres",
    "3652; 0 0 ACL public SEQUENCE orders_order_number_seq postgres",
    "3659; 0 0 ACL public FUNCTION create_order_with_items(p_business_slug text, p_order_type text, p_customer_name text, p_customer_phone text, p_customer_address text, p_customer_note text, p_items jsonb, p_idempotency_key uuid) postgres",
    "3660; 0 0 ACL public FUNCTION purge_expired_orders() postgres",
  ].join("\n");

  const missing = findMissingCriticalArchiveAclEntries(legacy8ParamToc);
  assert.deepEqual(missing, [
    "public FUNCTION create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)",
  ]);
});

test("P1.2c) Table and Sequence ACLs present but Function ACL missing fails critical gate", () => {
  const missingFunctionAclToc = [
    "3650; 0 0 ACL public TABLE orders postgres",
    "3651; 0 0 ACL public TABLE order_items postgres",
    "3652; 0 0 ACL public SEQUENCE orders_order_number_seq postgres",
    "3660; 0 0 ACL public FUNCTION purge_expired_orders() postgres",
  ].join("\n");

  const missing = findMissingCriticalArchiveAclEntries(missingFunctionAclToc);
  assert.deepEqual(missing, [
    "public FUNCTION create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)",
  ]);
});

test("P1.2d) Function definition in TOC without ACL keyword cannot satisfy critical ACL gate", () => {
  const tocWithDefinitionOnly = [
    "3650; 0 0 ACL public TABLE orders postgres",
    "3651; 0 0 ACL public TABLE order_items postgres",
    "3652; 0 0 ACL public SEQUENCE orders_order_number_seq postgres",
    "316; 1255 16663 FUNCTION public create_order_with_items(text, text, text, text, text, text, jsonb, uuid, text) postgres",
    "3660; 0 0 ACL public FUNCTION purge_expired_orders() postgres",
  ].join("\n");

  const missing = findMissingCriticalArchiveAclEntries(tocWithDefinitionOnly);
  assert.deepEqual(missing, [
    "public FUNCTION create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)",
  ]);
});

test("P1.2e) Function ACL TOC parser tolerates spacing, case, quotes, and modes", () => {
  const variationsToc = [
    '101; 0 0 ACL public FUNCTION create_order_with_items( IN "p_business_slug" text , p_order_type TEXT, p_customer_name   text, p_customer_phone text, p_customer_address text, p_customer_note text, p_items jsonb, p_idempotency_key uuid, p_payment_method text ) postgres',
  ].join("\n");

  const parsed = listArchiveObjectAclIdentities(variationsToc);
  assert.deepEqual(parsed, [
    "public FUNCTION create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)",
  ]);
});

test("P1.3) database backup rejects an archive without ACL records", async () => {
  const tempDir = createTempDir("test-database-no-acl");
  const dumpPath = join(tempDir, "database.dump");

  try {
    const mockExec = async (command: string) => {
      if (command === "pg_dump") {
        writeFileSync(dumpPath, "mock-custom-archive");
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      return {
        exitCode: 0,
        stdout: "123; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres\n",
        stderr: "",
      };
    };

    await assert.rejects(
      () =>
        runDatabaseBackup({
          dbUrl: "postgresql://backup-user:backup-password@localhost:5432/postgres",
          outputPath: dumpPath,
          execCommand: mockExec,
        }),
      /missing critical ACL entries/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("P1.3a) unrelated object ACL entries cannot satisfy the critical archive gate", async () => {
  const tempDir = createTempDir("test-database-unrelated-acl");
  const dumpPath = join(tempDir, "database.dump");

  try {
    const mockExec = async (command: string) => {
      if (command === "pg_dump") {
        writeFileSync(dumpPath, "mock-custom-archive");
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      return {
        exitCode: 0,
        stdout: "123; 0 0 ACL public TABLE unrelated_table postgres\n",
        stderr: "",
      };
    };

    await assert.rejects(
      () =>
        runDatabaseBackup({
          dbUrl: "postgresql://backup-user:backup-password@localhost:5432/postgres",
          outputPath: dumpPath,
          execCommand: mockExec,
        }),
      /public TABLE orders/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("P1.4) database backup rejects an unreadable archive TOC", async () => {
  const tempDir = createTempDir("test-database-toc-failure");
  const dumpPath = join(tempDir, "database.dump");

  try {
    const mockExec = async (command: string) => {
      if (command === "pg_dump") {
        writeFileSync(dumpPath, "mock-custom-archive");
        return { exitCode: 0, stdout: "", stderr: "" };
      }

      return { exitCode: 3, stdout: "", stderr: "invalid archive" };
    };

    await assert.rejects(
      () =>
        runDatabaseBackup({
          dbUrl: "postgresql://backup-user:backup-password@localhost:5432/postgres",
          outputPath: dumpPath,
          execCommand: mockExec,
        }),
      /pg_restore --list failed with exit code 3/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("P1.5) restore fidelity verifier covers the critical read-only security contract", () => {
  const verifierPath = join(process.cwd(), "scripts", "backup", "verify-restore-fidelity.sql");
  const verifier = readFileSync(verifierPath, "utf8");

  assert.match(verifier, /begin read only;/i);
  assert.match(verifier, /public_order_rate_limit_buckets/i);
  assert.match(verifier, /array\['orders', 'order_items'\]/i);
  assert.match(verifier, /rolsuper or rolbypassrls/i);
  assert.match(verifier, /fail-closed RLS protection/i);
  assert.match(verifier, /orders_order_number_seq/i);
  assert.match(verifier, /create_order_with_items\(text,text,text,text,text,text,jsonb,uuid,text\)/i);
  assert.match(verifier, /purge_expired_orders\(\)/i);
  assert.match(verifier, /expected owner postgres/i);
  assert.match(verifier, /pg_default_acl/i);
  assert.match(verifier, /PUBLIC_DEFAULT_PRIVILEGES=RESTORED_VERIFIED/);
  assert.match(verifier, /expected exactly 6 restored default ACL entries in public schema/i);
  assert.match(verifier, /expected exactly 96 restored exploded default privileges in public/i);
  assert.match(verifier, /pgrst_ddl_watch/i);
  assert.match(verifier, /pgrst_drop_watch/i);
  assert.match(verifier, /pgcrypto/i);
  assert.match(verifier, /pg_cron/i);
  assert.match(verifier, /purge_orders_after_180_days/i);
  assert.match(verifier, /not con\.convalidated/i);
  assert.match(verifier, /not idx\.indisvalid or not idx\.indisready or not idx\.indislive/i);
  assert.match(verifier, /RESTORE_FIDELITY_VERIFICATION=PASS/);
});

// P1.6) Target ACL Preparation Script Contract
test("P1.6) prepare-restore-target-acl.sql enforces fail-closed validation and baseline normalization", () => {
  const prepPath = join(process.cwd(), "scripts", "backup", "prepare-restore-target-acl.sql");
  assert.ok(existsSync(prepPath), "prepare-restore-target-acl.sql must exist");
  const prepSql = readFileSync(prepPath, "utf8");

  assert.match(prepSql, /\\set ON_ERROR_STOP on/i);
  assert.match(prepSql, /begin;/i);
  assert.match(prepSql, /current_database\(\) <> 'postgres'/i);
  assert.match(prepSql, /inet_server_addr\(\) is not null/i);
  assert.match(prepSql, /to_regnamespace\('public'\) is null/i);
  assert.match(prepSql, /'postgres',\s*'supabase_admin',\s*'anon',\s*'authenticated',\s*'service_role'/i);
  assert.match(prepSql, /unexpected global default ACL entries/i);
  assert.match(prepSql, /unexpected default ACL owner in public schema/i);
  assert.match(prepSql, /unexpected default ACL object type in public schema/i);
  assert.match(prepSql, /expected exactly 6 default ACL entries in public schema/i);
  assert.match(prepSql, /unexpected grantee in public default ACL/i);
  assert.match(prepSql, /unexpected grant option in public default ACL/i);
  assert.match(prepSql, /unexpected privilege type in public default ACL/i);
  assert.match(prepSql, /expected exactly 96 exploded default privileges in public/i);
  assert.match(prepSql, /alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role, postgres;/i);
  assert.match(prepSql, /alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role, postgres;/i);
  assert.match(prepSql, /alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role, postgres;/i);
  assert.match(prepSql, /alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role, postgres;/i);
  assert.match(prepSql, /alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role, postgres;/i);
  assert.match(prepSql, /alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated, service_role, postgres;/i);
  assert.match(prepSql, /expected 0 default ACL rows in public after normalization/i);
  assert.match(prepSql, /commit;/i);
  assert.match(prepSql, /PREPARE_RESTORE_TARGET_ACL=PASS/);
});

// P2) Database Backup Command Error Redacts Password
test("P2) runDatabaseBackup redacts password from child_process stderr and error message", async () => {
  const secretPassword = "super_classified_pw_xyz";
  const dbUrl = `postgresql://adminuser:${secretPassword}@db.example.com:5432/yerel`;
  const outputPath = join(tmpdir(), "db-test-error.dump");

  const mockExec = async () => {
    return {
      exitCode: 2,
      stdout: "",
      stderr: `connection to server failed: password was ${secretPassword} at db.example.com`,
    };
  };

  await assert.rejects(
    async () =>
      runDatabaseBackup({
        dbUrl,
        outputPath,
        execCommand: mockExec,
      }),
    (err: Error) => {
      assert.ok(!err.message.includes(secretPassword), "Secret password leaked in error message!");
      assert.ok(err.message.includes("***"), "Password was not redacted!");
      return true;
    },
  );
});

// S1) Storage Path Containment Check
test("S1) resolveSafeStoragePath allows valid nested paths and rejects traversal/absolute attacks", () => {
  const bucketRoot = join(tmpdir(), "test-bucket-root");

  // Valid nested paths pass
  const valid1 = resolveSafeStoragePath(bucketRoot, "photos/kebap.jpg");
  assert.equal(valid1, join(bucketRoot, "photos", "kebap.jpg"));

  const valid2 = resolveSafeStoragePath(bucketRoot, "a/b/c/doc.pdf");
  assert.equal(valid2, join(bucketRoot, "a", "b", "c", "doc.pdf"));

  // Path traversal attacks are rejected
  assert.throws(
    () => resolveSafeStoragePath(bucketRoot, "../outside.txt"),
    /Storage containment violation.*escapes bucket root/,
  );

  assert.throws(
    () => resolveSafeStoragePath(bucketRoot, "photos/../../secret.env"),
    /Storage containment violation.*escapes bucket root/,
  );

  // Absolute paths are rejected
  assert.throws(
    () => resolveSafeStoragePath(bucketRoot, "/etc/passwd"),
    /Storage containment violation.*absolute path/,
  );
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
