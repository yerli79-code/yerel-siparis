export interface BackupEnv {
  SUPABASE_DB_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GOOGLE_DRIVE_CLIENT_ID: string;
  GOOGLE_DRIVE_CLIENT_SECRET: string;
  GOOGLE_DRIVE_REFRESH_TOKEN: string;
}

export interface BackupEnvStatus {
  name: keyof BackupEnv;
  configured: boolean;
}

export interface DatabaseDumpResult {
  filename: string;
  filePath: string;
  bytes: number;
  sha256: string;
}

export interface StorageObjectMeta {
  bucket: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface StorageBackupResult {
  archiveFilename: string;
  archivePath: string;
  archiveBytes: number;
  archiveSha256: string;
  bucketCount: number;
  objectCount: number;
  totalBytes: number;
  objects: StorageObjectMeta[];
}

export interface BackupManifest {
  formatVersion: 1;
  createdAtUtc: string;
  gitSha: string;
  database: {
    filename: string;
    bytes: number;
    sha256: string;
  };
  storage: {
    archive: string;
    bucketCount: number;
    objectCount: number;
    totalBytes: number;
    archiveBytes: number;
    archiveSha256: string;
    objects: StorageObjectMeta[];
  };
}

export interface DriveAppProperties {
  appName: string;
  role: "root" | "backup" | "artifact";
  formatVersion?: string;
  complete?: "true" | "false";
  createdAt?: string;
  yerelSiparisBackup?: string;
  [key: string]: string | undefined;
}

export interface DriveFolderRecord {
  id: string;
  name: string;
  createdTime?: string;
  appProperties?: DriveAppProperties;
  parents?: string[];
  trashed?: boolean;
}

export interface DriveFileRecord {
  id: string;
  name: string;
  size?: string;
  md5Checksum?: string;
  appProperties?: DriveAppProperties;
}

export interface RetentionPlan {
  keepSet: DriveFolderRecord[];
  deleteSet: DriveFolderRecord[];
  excludedCount: number;
}
