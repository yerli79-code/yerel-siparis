import { openSync, readSync, closeSync, statSync } from "node:fs";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { computeFileMd5 } from "./crypto-util.ts";
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
  chunkSize?: number;
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
    chunkSize = 8 * 1024 * 1024,
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

    const localMd5 = await computeFileMd5(filePath);
    const totalSize = stats.size;

    // 1. Initiate resumable upload session
    const metadata = {
      name: fileName,
      parents: [parentId],
      appProperties: {
        appName: "yerel-siparis",
        role: "artifact",
        formatVersion: "1",
        ...appProperties,
      },
    };

    const initUrl =
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,appProperties";

    const initRes = await this.request(initUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": totalSize.toString(),
      },
      body: JSON.stringify(metadata),
    });

    if (!initRes.ok) {
      throw new Error(
        `Failed to initiate resumable upload for "${fileName}". HTTP ${initRes.status}: ${initRes.statusText}`,
      );
    }

    const sessionUri = initRes.headers.get("location");
    if (!sessionUri) {
      throw new Error(
        `Google Drive resumable upload session initiation did not return a Location header for "${fileName}".`,
      );
    }

    // 2. Upload file in chunks from disk (without loading the entire file into RAM)
    let finalRemoteFile: DriveFileRecord | null = null;

    if (totalSize === 0) {
      const putRes = await this.request(sessionUri, {
        method: "PUT",
        headers: {
          "Content-Length": "0",
          "Content-Range": "bytes */0",
          "Content-Type": mimeType,
        },
        body: Buffer.alloc(0),
      });

      if (!putRes.ok && putRes.status !== 201) {
        throw new Error(
          `Failed to upload 0-byte file "${fileName}". HTTP ${putRes.status}: ${putRes.statusText}`,
        );
      }

      finalRemoteFile = (await putRes.json()) as DriveFileRecord;
    } else {
      let offset = 0;
      const fd = openSync(filePath, "r");

      try {
        while (offset < totalSize) {
          const bytesToRead = Math.min(chunkSize, totalSize - offset);
          const chunkBuffer = Buffer.alloc(bytesToRead);
          const bytesRead = readSync(fd, chunkBuffer, 0, bytesToRead, offset);
          if (bytesRead !== bytesToRead) {
            throw new Error(
              `Failed to read expected ${bytesToRead} bytes from ${filePath} (read ${bytesRead} bytes).`,
            );
          }

          const chunkEnd = offset + bytesRead - 1;
          const isFinalChunk = offset + bytesRead === totalSize;

          const putRes = await this.request(sessionUri, {
            method: "PUT",
            headers: {
              "Content-Length": bytesRead.toString(),
              "Content-Range": `bytes ${offset}-${chunkEnd}/${totalSize}`,
              "Content-Type": mimeType,
            },
            body: chunkBuffer,
          });

          if (isFinalChunk) {
            if (putRes.status !== 200 && putRes.status !== 201) {
              throw new Error(
                `Failed to finalize resumable upload for "${fileName}". HTTP ${putRes.status}: ${putRes.statusText}`,
              );
            }
            finalRemoteFile = (await putRes.json()) as DriveFileRecord;
          } else {
            if (putRes.status !== 308) {
              throw new Error(
                `Resumable upload chunk failed for "${fileName}" at bytes ${offset}-${chunkEnd}. HTTP ${putRes.status}: ${putRes.statusText}`,
              );
            }
          }

          offset += bytesRead;
        }
      } finally {
        closeSync(fd);
      }
    }

    if (!finalRemoteFile) {
      throw new Error(
        `Resumable upload did not produce a remote file record for "${fileName}".`,
      );
    }

    // If size or md5Checksum is missing from final response, query file metadata explicitly
    if (!finalRemoteFile.size || !finalRemoteFile.md5Checksum) {
      const getUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(finalRemoteFile.id)}?fields=id,name,size,md5Checksum,appProperties`;
      const getRes = await this.request(getUrl);
      if (getRes.ok) {
        finalRemoteFile = (await getRes.json()) as DriveFileRecord;
      }
    }

    // 3. Remote upload integrity verification
    this.verifyRemoteIntegrity(fileName, finalRemoteFile, totalSize, localMd5);

    return finalRemoteFile;
  }

  verifyRemoteIntegrity(
    fileName: string,
    remoteFile: DriveFileRecord,
    expectedSize: number,
    expectedMd5: string,
  ): void {
    if (!remoteFile || !remoteFile.id) {
      throw new Error(
        `Remote integrity verification failed: no valid file record for "${fileName}" (fail-closed).`,
      );
    }

    if (remoteFile.size === undefined || remoteFile.size === null) {
      throw new Error(
        `Remote integrity verification failed: missing remote size for "${fileName}" (fail-closed).`,
      );
    }

    const remoteSizeNum = Number(remoteFile.size);
    if (remoteSizeNum !== expectedSize) {
      throw new Error(
        `Remote size mismatch for "${fileName}": expected ${expectedSize} bytes, got ${remoteSizeNum} bytes (fail-closed).`,
      );
    }

    if (!remoteFile.md5Checksum) {
      throw new Error(
        `Remote integrity verification failed: missing remote md5Checksum for "${fileName}" (fail-closed).`,
      );
    }

    if (remoteFile.md5Checksum.toLowerCase() !== expectedMd5.toLowerCase()) {
      throw new Error(
        `Remote checksum mismatch for "${fileName}": expected MD5 ${expectedMd5}, got ${remoteFile.md5Checksum} (fail-closed).`,
      );
    }
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
