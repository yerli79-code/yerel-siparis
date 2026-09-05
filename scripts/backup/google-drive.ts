import { readFileSync, statSync } from "node:fs";
import type {
  DriveAppProperties,
  DriveFileRecord,
  DriveFolderRecord,
} from "./types.ts";

export interface GoogleDriveAuthOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchFn?: typeof fetch;
}

export interface GoogleDriveClientOptions {
  accessToken: string;
  fetchFn?: typeof fetch;
}

export interface UploadFileOptions {
  parentId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  appProperties?: Record<string, string>;
}

export async function refreshGoogleDriveAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchFn = fetch,
}: GoogleDriveAuthOptions): Promise<string> {
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  let res: Response;
  try {
    res = await fetchFn(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Network error";
    throw new Error(`Google OAuth network failure: ${msg}`);
  }

  if (!res.ok) {
    // Sanitize response: do not log raw body to avoid leaking error tokens/secrets
    throw new Error(
      `Google OAuth token refresh failed with HTTP ${res.status}: ${res.statusText}`,
    );
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data || typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Google OAuth token refresh returned invalid or missing access_token.");
  }

  return data.access_token;
}

export class GoogleDriveClient {
  private accessToken: string;
  private fetchFn: typeof fetch;

  constructor({ accessToken, fetchFn = fetch }: GoogleDriveClientOptions) {
    this.accessToken = accessToken;
    this.fetchFn = fetchFn;
  }

  private async request(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.accessToken}`);

    const res = await this.fetchFn(url, {
      ...options,
      headers,
    });

    return res;
  }

  async findOrCreateRootFolder(
    folderName: string = "Yerel-Siparis-Backups",
  ): Promise<DriveFolderRecord> {
    const q = [
      "mimeType = 'application/vnd.google-apps.folder'",
      `name = '${folderName.replace(/'/g, "\\'")}'`,
      "trashed = false",
      "appProperties has { key='appName' and value='yerel-siparis' }",
      "appProperties has { key='role' and value='root' }",
    ].join(" and ");

    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id, name, appProperties, trashed)")}&spaces=drive`;

    const searchRes = await this.request(searchUrl);
    if (!searchRes.ok) {
      throw new Error(
        `Failed to search Google Drive root folder. HTTP ${searchRes.status}: ${searchRes.statusText}`,
      );
    }

    const searchData = (await searchRes.json()) as {
      files?: DriveFolderRecord[];
    };

    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0];
    }

    // Create root folder
    const createRes = await this.request("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: {
          appName: "yerel-siparis",
          role: "root",
          yerelSiparisBackup: "v1",
        },
      }),
    });

    if (!createRes.ok) {
      throw new Error(
        `Failed to create Google Drive root folder. HTTP ${createRes.status}: ${createRes.statusText}`,
      );
    }

    const created = (await createRes.json()) as DriveFolderRecord;
    return created;
  }

  async createBackupFolder(
    rootFolderId: string,
    backupFolderName: string,
  ): Promise<DriveFolderRecord> {
    const metadata = {
      name: backupFolderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
      appProperties: {
        appName: "yerel-siparis",
        role: "backup",
        formatVersion: "1",
        complete: "false",
        createdAt: backupFolderName,
        yerelSiparisBackup: "v1",
      },
    };

    const res = await this.request("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to create Google Drive backup folder "${backupFolderName}". HTTP ${res.status}: ${res.statusText}`,
      );
    }

    return (await res.json()) as DriveFolderRecord;
  }

  async uploadFile({
    parentId,
    filePath,
    fileName,
    mimeType,
    appProperties = {},
  }: UploadFileOptions): Promise<DriveFileRecord> {
    const stats = statSync(filePath);
    if (stats.size === 0 && !fileName.endsWith("empty")) {
      // 0-byte file check for critical backup artifacts
      if (fileName === "database.dump" || fileName === "storage.tar.gz") {
        throw new Error(
          `Refusing to upload 0-byte file "${fileName}" to Google Drive (fail-closed).`,
        );
      }
    }

    const fileBuffer = readFileSync(filePath);
    const boundary = "-------YerelSiparisBackupBoundary" + Date.now().toString(16);

    const metadataPart = JSON.stringify({
      name: fileName,
      parents: [parentId],
      appProperties: {
        appName: "yerel-siparis",
        role: "artifact",
        formatVersion: "1",
        ...appProperties,
      },
    });

    const header = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      "utf8",
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const multipartBody = Buffer.concat([header, fileBuffer, footer]);

    const uploadUrl =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,md5Checksum,appProperties";

    const res = await this.request(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": multipartBody.length.toString(),
      },
      body: multipartBody,
    });

    if (!res.ok) {
      throw new Error(
        `Failed to upload "${fileName}" to Google Drive. HTTP ${res.status}: ${res.statusText}`,
      );
    }

    return (await res.json()) as DriveFileRecord;
  }

  async markBackupComplete(folderId: string): Promise<void> {
    const patchUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`;
    const res = await this.request(patchUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appProperties: {
          complete: "true",
        },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to mark backup folder ${folderId} as complete=true. HTTP ${res.status}: ${res.statusText}`,
      );
    }
  }

  async listBackupFolders(rootFolderId: string): Promise<DriveFolderRecord[]> {
    const q = [
      `'${rootFolderId.replace(/'/g, "\\'")}' in parents`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
    ].join(" and ");

    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id, name, createdTime, appProperties, parents, trashed)")}&pageSize=1000`;

    const res = await this.request(url);
    if (!res.ok) {
      throw new Error(
        `Failed to list backup folders from Google Drive. HTTP ${res.status}: ${res.statusText}`,
      );
    }

    const data = (await res.json()) as { files?: DriveFolderRecord[] };
    return data.files ?? [];
  }

  async deleteFolder(folderId: string): Promise<void> {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`;
    const res = await this.request(url, { method: "DELETE" });

    if (!res.ok && res.status !== 404) {
      throw new Error(
        `Failed to delete folder ${folderId} from Google Drive. HTTP ${res.status}: ${res.statusText}`,
      );
    }
  }
}
