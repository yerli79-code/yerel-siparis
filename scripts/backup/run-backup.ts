import { mkdtempSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { validateBackupEnv, getBackupEnvStatus, formatEnvStatusReport } from "./env.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { runDatabaseBackup, checkPgDumpVersion } from "./database-backup.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { runStorageBackup } from "./storage-backup.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { writeManifestAndChecksums } from "./manifest.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { refreshGoogleDriveAccessToken, GoogleDriveClient, uploadAndFinalizeBackupArtifacts } from "./google-drive.ts";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { selectRetentionPlan, applyRetentionPlan } from "./retention.ts";

export async function executeBackupPipeline(): Promise<void> {
  console.log("=== Yerel Siparis Production Backup Automation ===");
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // 1. Validate environment
  console.log("\n[1/7] Validating environment variables (masked)...");
  const statuses = getBackupEnvStatus();
  console.log(formatEnvStatusReport(statuses));
  const env = validateBackupEnv();
  console.log("Environment validation passed.");

  // 2. Setup secure temp directory
  console.log("\n[2/7] Creating secure temporary staging directory...");
  const prefix = join(tmpdir(), "yerel-siparis-backup-");
  const stagingDir = mkdtempSync(prefix);

  try {
    try {
      chmodSync(stagingDir, 0o700);
    } catch {
      // chmod may be a no-op on some Windows filesystems, ignore
    }

    const timestampIso = new Date().toISOString();
    const folderName = timestampIso.replace(/[:.]/g, "-").slice(0, 19) + "Z";
    console.log(`Backup identifier: ${folderName}`);

    // Check pg_dump version
    try {
      const pgVersion = await checkPgDumpVersion();
      console.log(`PostgreSQL client: ${pgVersion}`);
    } catch (verErr: unknown) {
      console.warn(`Warning: Could not determine pg_dump version: ${verErr instanceof Error ? verErr.message : String(verErr)}`);
    }

    // 3. Database Backup
    console.log("\n[3/7] Taking PostgreSQL database backup (custom format)...");
    const dbDumpPath = join(stagingDir, "database.dump");
    const dbResult = await runDatabaseBackup({
      dbUrl: env.SUPABASE_DB_URL,
      outputPath: dbDumpPath,
    });
    console.log(`Database dump complete: ${dbResult.bytes} bytes, SHA-256: ${dbResult.sha256}`);

    // 4. Supabase Storage Backup
    console.log("\n[4/7] Exporting Supabase Storage buckets & objects...");
    const storageResult = await runStorageBackup({
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      stagingDir,
    });
    console.log(
      `Storage export complete: ${storageResult.bucketCount} buckets, ${storageResult.objectCount} objects, archive ${storageResult.archiveBytes} bytes, SHA-256: ${storageResult.archiveSha256}`,
    );

    // 5. Manifest & Checksums
    console.log("\n[5/7] Generating version 1 manifest and SHA256SUMS.txt...");
    const gitSha = process.env.GITHUB_SHA || "unknown-sha";
    const manifestResult = writeManifestAndChecksums({
      stagingDir,
      gitSha,
      createdAtUtc: timestampIso,
      database: dbResult,
      storage: storageResult,
    });
    console.log(`Manifest created: formatVersion ${manifestResult.manifest.formatVersion}, SHA-256: ${manifestResult.manifestSha256}`);

    // 6. Google Drive Upload
    console.log("\n[6/7] Authenticating and uploading backup artifacts to Google Drive...");
    const accessToken = await refreshGoogleDriveAccessToken({
      clientId: env.GOOGLE_DRIVE_CLIENT_ID,
      clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN,
    });

    const driveClient = new GoogleDriveClient({ accessToken });
    const rootFolder = await driveClient.findOrCreateRootFolder("Yerel-Siparis-Backups");
    console.log(`Google Drive root folder verified (ID: ${rootFolder.id})`);

    // Create backup folder initially marked complete: "false"
    const backupFolder = await driveClient.createBackupFolder(rootFolder.id, folderName);
    console.log(`Backup folder created with complete=false (ID: ${backupFolder.id})`);

    // Upload and verify the 4 artifacts, then atomically mark complete=true
    const artifacts = [
      {
        filePath: dbResult.filePath,
        fileName: dbResult.filename,
        mimeType: "application/octet-stream",
      },
      {
        filePath: storageResult.archivePath,
        fileName: storageResult.archiveFilename,
        mimeType: "application/gzip",
      },
      {
        filePath: manifestResult.manifestPath,
        fileName: "manifest.json",
        mimeType: "application/json",
      },
      {
        filePath: manifestResult.sumsPath,
        fileName: "SHA256SUMS.txt",
        mimeType: "text/plain",
      },
    ];

    console.log("Uploading and verifying 4 backup artifacts via resumable upload...");
    await uploadAndFinalizeBackupArtifacts({
      driveClient,
      backupFolderId: backupFolder.id,
      artifacts,
    });
    console.log(`Backup atomically verified and completed in Google Drive folder "${folderName}" (complete=true)`);

    // 7. Retention Management
    console.log("\n[7/7] Evaluating retention policy...");
    const existingFolders = await driveClient.listBackupFolders(rootFolder.id);
    const retentionPlan = selectRetentionPlan(existingFolders, rootFolder.id);

    console.log(
      `Retention evaluation: Total folders: ${existingFolders.length}, Keep: ${retentionPlan.keepSet.length}, Delete: ${retentionPlan.deleteSet.length}, Excluded (unmarked/incomplete): ${retentionPlan.excludedCount}`,
    );

    const dryRun = process.env.DRIVE_DRY_RUN === "true";
    const retentionResult = await applyRetentionPlan({
      plan: retentionPlan,
      driveClient,
      dryRun,
    });

    if (retentionResult.dryRun) {
      console.log(`Retention dry-run complete. ${retentionResult.deletedCount} folders planned for deletion.`);
    } else {
      console.log(`Retention enforcement complete. Deleted ${retentionResult.deletedCount} expired backup folders.`);
    }

    console.log("\n=== Backup Pipeline Successfully Finished ===");
  } finally {
    // Local cleanup: remove temporary staging directory
    if (existsSync(stagingDir)) {
      try {
        rmSync(stagingDir, { recursive: true, force: true });
        console.log("Cleaned up local temporary staging directory.");
      } catch (cleanupErr) {
        console.warn("Notice: Failed to clean up temp staging directory:", cleanupErr);
      }
    }
  }
}

// Entrypoint execution when invoked directly via node
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("run-backup.ts") || process.argv[1].endsWith("run-backup.js"));

if (isMainModule) {
  executeBackupPipeline().catch((err) => {
    console.error("\nFATAL: Backup pipeline failed (fail-closed):", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
