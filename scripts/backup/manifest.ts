import { writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { computeBufferSha256, formatSha256Sums } from "./crypto-util.ts";
import type {
  BackupManifest,
  DatabaseDumpResult,
  StorageBackupResult,
} from "./types.ts";

export interface CreateManifestOptions {
  stagingDir: string;
  gitSha: string;
  createdAtUtc: string;
  database: DatabaseDumpResult;
  storage: StorageBackupResult;
}

export function buildManifest({
  gitSha,
  createdAtUtc,
  database,
  storage,
}: Omit<CreateManifestOptions, "stagingDir">): BackupManifest {
  // Validate that no secrets or database connection URLs sneak into manifest
  const serializedDb = JSON.stringify(database);
  if (
    serializedDb.includes("postgres://") ||
    serializedDb.includes("postgresql://") ||
    serializedDb.includes("@")
  ) {
    throw new Error("Potential secret or URL detected in database manifest metadata.");
  }

  return {
    formatVersion: 1,
    createdAtUtc,
    gitSha,
    database: {
      filename: database.filename,
      bytes: database.bytes,
      sha256: database.sha256,
    },
    storage: {
      archive: storage.archiveFilename,
      bucketCount: storage.bucketCount,
      objectCount: storage.objectCount,
      totalBytes: storage.totalBytes,
      archiveBytes: storage.archiveBytes,
      archiveSha256: storage.archiveSha256,
      objects: storage.objects,
    },
  };
}

export function writeManifestAndChecksums(
  options: CreateManifestOptions,
): {
  manifest: BackupManifest;
  manifestPath: string;
  manifestSha256: string;
  sumsPath: string;
} {
  const manifest = buildManifest(options);
  const manifestContent = JSON.stringify(manifest, null, 2) + "\n";
  const manifestPath = join(options.stagingDir, "manifest.json");

  writeFileSync(manifestPath, manifestContent, "utf8");

  const manifestSha256 = computeBufferSha256(manifestContent);

  const sumsPath = join(options.stagingDir, "SHA256SUMS.txt");
  const sumsContent = formatSha256Sums([
    { filename: options.database.filename, sha256: options.database.sha256 },
    { filename: options.storage.archiveFilename, sha256: options.storage.archiveSha256 },
    { filename: "manifest.json", sha256: manifestSha256 },
  ]);

  writeFileSync(sumsPath, sumsContent, "utf8");

  return {
    manifest,
    manifestPath,
    manifestSha256,
    sumsPath,
  };
}
