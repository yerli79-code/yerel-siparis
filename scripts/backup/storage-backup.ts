import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { computeBufferSha256, computeFileSha256 } from "./crypto-util.ts";
import type { StorageBackupResult, StorageObjectMeta } from "./types.ts";

export interface StorageBackupOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  stagingDir: string;
  fetchFn?: typeof fetch;
  execCommand?: (
    command: string,
    args: string[],
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface SupabaseBucketInfo {
  id: string;
  name: string;
  public?: boolean;
}

export interface SupabaseStorageItem {
  name: string;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function defaultArchiveCommand(
  command: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => reject(err));

    proc.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

export async function listBuckets(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<SupabaseBucketInfo[]> {
  const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/bucket`;
  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to list Supabase storage buckets. HTTP ${res.status}: ${res.statusText}`,
    );
  }

  const data = (await res.json()) as SupabaseBucketInfo[];
  if (!Array.isArray(data)) {
    throw new Error("Invalid response format when listing storage buckets.");
  }

  return data;
}

export async function listBucketObjectsRecursive(
  supabaseUrl: string,
  serviceRoleKey: string,
  bucketId: string,
  prefix: string = "",
  fetchFn: typeof fetch = fetch,
  depth: number = 0,
): Promise<Array<{ bucket: string; path: string }>> {
  if (depth > 25) {
    throw new Error(
      `Storage recursion depth limit exceeded for bucket "${bucketId}" at prefix "${prefix}" (fail-closed).`,
    );
  }

  const objects: Array<{ bucket: string; path: string }> = [];
  const limit = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/list/${encodeURIComponent(bucketId)}`;
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });

    if (!res.ok) {
      throw new Error(
        `Failed to list objects in bucket "${bucketId}" with prefix "${prefix}". HTTP ${res.status}: ${res.statusText}`,
      );
    }

    const items = (await res.json()) as SupabaseStorageItem[];
    if (!Array.isArray(items)) {
      throw new Error(`Unexpected object listing format for bucket "${bucketId}".`);
    }

    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.id === null) {
        // Folder / prefix placeholder: recursively traverse
        const subObjects = await listBucketObjectsRecursive(
          supabaseUrl,
          serviceRoleKey,
          bucketId,
          fullPath,
          fetchFn,
          depth + 1,
        );
        objects.push(...subObjects);
      } else {
        // Real object
        objects.push({ bucket: bucketId, path: fullPath });
      }
    }

    if (items.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  return objects;
}

export async function downloadStorageObject(
  supabaseUrl: string,
  serviceRoleKey: string,
  bucketId: string,
  objectPath: string,
  fetchFn: typeof fetch = fetch,
): Promise<Buffer> {
  const normalizedBase = supabaseUrl.replace(/\/+$/, "");
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${normalizedBase}/storage/v1/object/authenticated/${encodeURIComponent(bucketId)}/${encodedPath}`;

  const res = await fetchFn(url, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to download object "${objectPath}" from bucket "${bucketId}". HTTP ${res.status}: ${res.statusText}`,
    );
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function runStorageBackup({
  supabaseUrl,
  serviceRoleKey,
  stagingDir,
  fetchFn = fetch,
  execCommand = defaultArchiveCommand,
}: StorageBackupOptions): Promise<StorageBackupResult> {
  const storageRootDir = join(stagingDir, "storage");
  mkdirSync(storageRootDir, { recursive: true });

  const buckets = await listBuckets(supabaseUrl, serviceRoleKey, fetchFn);
  const objectsMeta: StorageObjectMeta[] = [];
  let totalBytes = 0;

  for (const bucket of buckets) {
    const bucketObjects = await listBucketObjectsRecursive(
      supabaseUrl,
      serviceRoleKey,
      bucket.id,
      "",
      fetchFn,
    );

    for (const obj of bucketObjects) {
      const content = await downloadStorageObject(
        supabaseUrl,
        serviceRoleKey,
        obj.bucket,
        obj.path,
        fetchFn,
      );

      const targetPath = join(storageRootDir, obj.bucket, obj.path);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, content);

      const sha256 = computeBufferSha256(content);
      const bytes = content.length;
      totalBytes += bytes;

      objectsMeta.push({
        bucket: obj.bucket,
        path: obj.path,
        bytes,
        sha256,
      });
    }
  }

  // Create storage.tar.gz archive containing the storage directory
  const archiveFilename = "storage.tar.gz";
  const archivePath = join(stagingDir, archiveFilename);

  const archiveResult = await execCommand("tar", [
    "-czf",
    archivePath,
    "-C",
    stagingDir,
    "storage",
  ]);

  if (archiveResult.exitCode !== 0) {
    throw new Error(
      `Failed to package storage.tar.gz archive. Exit code ${archiveResult.exitCode}: ${archiveResult.stderr.trim() || "unknown error"}`,
    );
  }

  const archiveStats = statSync(archivePath);
  const archiveSha256 = await computeFileSha256(archivePath);

  return {
    archiveFilename,
    archivePath,
    archiveBytes: archiveStats.size,
    archiveSha256,
    bucketCount: buckets.length,
    objectCount: objectsMeta.length,
    totalBytes,
    objects: objectsMeta,
  };
}
