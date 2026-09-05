import { spawn } from "node:child_process";
import { statSync } from "node:fs";
// @ts-expect-error The local TypeScript test runner resolves source extensions.
import { computeFileSha256 } from "./crypto-util.ts";
import type { DatabaseDumpResult } from "./types.ts";

export interface DatabaseBackupOptions {
  dbUrl: string;
  outputPath: string;
  execCommand?: (
    command: string,
    args: string[],
    env: Record<string, string | undefined>,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const user = parsed.username ? "***" : "";
    const pass = parsed.password ? ":***" : "";
    const auth = user || pass ? `${user}${pass}@` : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${auth}${parsed.hostname}${port}${parsed.pathname}`;
  } catch {
    return "[MASKED_DB_URL]";
  }
}

export async function defaultExecCommand(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
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

export async function checkPgDumpVersion(
  execCommand: NonNullable<DatabaseBackupOptions["execCommand"]> = defaultExecCommand,
): Promise<string> {
  try {
    const res = await execCommand("pg_dump", ["--version"], {});
    if (res.exitCode !== 0) {
      throw new Error(`pg_dump --version failed with exit code ${res.exitCode}`);
    }
    const versionString = res.stdout.trim() || res.stderr.trim();
    return versionString;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to check pg_dump version: ${msg}`);
  }
}

export interface ParsedDatabaseParams {
  host: string;
  port: string;
  username: string;
  dbname: string;
  sslmode: string;
  password?: string;
  args: string[];
  env: Record<string, string | undefined>;
}

export function parseDatabaseConnectionParams(
  dbUrl: string,
  outputPath: string,
): ParsedDatabaseParams {
  const parsed = new URL(dbUrl);
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const username = decodeURIComponent(parsed.username || "");
  const dbname = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "postgres";
  const sslmode = parsed.searchParams.get("sslmode") || "require";
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  const args = [
    `--host=${host}`,
    `--port=${port}`,
    ...(username ? [`--username=${username}`] : []),
    `--dbname=${dbname}`,
    "--format=custom",
    "--no-owner",
    "--no-acl",
    `--file=${outputPath}`,
  ];

  const env: Record<string, string | undefined> = {
    PGCONNECT_TIMEOUT: "30",
    PGSSLMODE: sslmode,
  };

  if (password) {
    env.PGPASSWORD = password;
  }

  return { host, port, username, dbname, sslmode, password, args, env };
}

export async function runDatabaseBackup({
  dbUrl,
  outputPath,
  execCommand = defaultExecCommand,
}: DatabaseBackupOptions): Promise<DatabaseDumpResult> {
  if (!dbUrl || dbUrl.trim().length === 0) {
    throw new Error("SUPABASE_DB_URL is required for database backup.");
  }

  const maskedUrl = maskDatabaseUrl(dbUrl);
  const connParams = parseDatabaseConnectionParams(dbUrl, outputPath);

  const result = await execCommand("pg_dump", connParams.args, connParams.env);

  if (result.exitCode !== 0) {
    // Sanitize any raw DB URL or password in stderr
    let sanitizedStderr = result.stderr.split(dbUrl).join(maskedUrl);
    if (connParams.password) {
      sanitizedStderr = sanitizedStderr.split(connParams.password).join("***");
    }
    sanitizedStderr = sanitizedStderr.replace(/:[^@:]+@/g, ":***@");
    throw new Error(
      `pg_dump failed with exit code ${result.exitCode}. Stderr: ${sanitizedStderr.trim() || "none"}`,
    );
  }

  let stats;
  try {
    stats = statSync(outputPath);
  } catch {
    throw new Error(`pg_dump reported success, but dump file was not found at ${outputPath}`);
  }

  if (stats.size === 0) {
    throw new Error(
      `Database dump produced a 0-byte file at ${outputPath}. Rejecting backup (fail-closed).`,
    );
  }

  const sha256 = await computeFileSha256(outputPath);

  return {
    filename: "database.dump",
    filePath: outputPath,
    bytes: stats.size,
    sha256,
  };
}
