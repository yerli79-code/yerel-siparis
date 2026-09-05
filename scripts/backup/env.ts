import type { BackupEnv, BackupEnvStatus } from "./types.ts";

export const REQUIRED_BACKUP_ENV_VARS: Array<keyof BackupEnv> = [
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_BACKUP_SECRET_KEY",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
];

export function getBackupEnvStatus(
  envSource: Record<string, string | undefined> = process.env,
): BackupEnvStatus[] {
  return REQUIRED_BACKUP_ENV_VARS.map((name) => ({
    name,
    configured: Boolean(envSource[name] && envSource[name]!.trim().length > 0),
  }));
}

export function formatEnvStatusReport(statuses: BackupEnvStatus[]): string {
  return statuses
    .map((s) => `  ${s.name}: ${s.configured ? "configured" : "MISSING"}`)
    .join("\n");
}

export function validateBackupEnv(
  envSource: Record<string, string | undefined> = process.env,
): BackupEnv {
  const statuses = getBackupEnvStatus(envSource);
  const missing = statuses.filter((s) => !s.configured);

  if (missing.length > 0) {
    const missingNames = missing.map((m) => m.name).join(", ");
    throw new Error(
      `Backup environment validation failed. Missing required variables: [${missingNames}]. Aborting backup (fail-closed).`,
    );
  }

  return {
    SUPABASE_DB_URL: envSource.SUPABASE_DB_URL!.trim(),
    SUPABASE_URL: envSource.SUPABASE_URL!.trim(),
    SUPABASE_BACKUP_SECRET_KEY: envSource.SUPABASE_BACKUP_SECRET_KEY!.trim(),
    GOOGLE_DRIVE_CLIENT_ID: envSource.GOOGLE_DRIVE_CLIENT_ID!.trim(),
    GOOGLE_DRIVE_CLIENT_SECRET: envSource.GOOGLE_DRIVE_CLIENT_SECRET!.trim(),
    GOOGLE_DRIVE_REFRESH_TOKEN: envSource.GOOGLE_DRIVE_REFRESH_TOKEN!.trim(),
  };
}
