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

const PG_RESTORE_ACL_TOC_ENTRY = /^\s*\d+;\s+\d+\s+\d+\s+(?:DEFAULT )?ACL(?:\s|$)/i;

export const REQUIRED_DATABASE_ACL_IDENTITIES = [
  "public TABLE orders",
  "public TABLE order_items",
  "public SEQUENCE orders_order_number_seq",
  "public FUNCTION create_order_with_items(text,text,text,text,text,text,jsonb,uuid,text)",
  "public FUNCTION purge_expired_orders()",
] as const;

const MULTI_WORD_POSTGRES_TYPES = [
  "double precision",
  "timestamp with time zone",
  "timestamp without time zone",
  "time with time zone",
  "time without time zone",
  "character varying",
  "bit varying",
] as const;

function normalizeFunctionArgument(arg: string): string {
  const trimmed = arg.trim();
  if (!trimmed) return "";

  // Strip leading parameter mode (IN, OUT, INOUT, VARIADIC)
  const withoutMode = trimmed.replace(/^(?:IN|OUT|INOUT|VARIADIC)\s+/i, "");
  const lower = withoutMode.toLowerCase();

  for (const mwt of MULTI_WORD_POSTGRES_TYPES) {
    if (lower === mwt || lower.startsWith(mwt + "[")) {
      return lower;
    }
  }

  // Strip parameter name if present (e.g. `param_name type` or `"param_name" type`)
  const paramMatch = withoutMode.match(/^(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)\s+(.+)$/);
  if (paramMatch) {
    return paramMatch[1].trim().toLowerCase();
  }

  return withoutMode.toLowerCase();
}

export function normalizeArchiveAclIdentity(identity: string): string {
  const trimmed = identity.trim();
  const funcMatch = trimmed.match(/^([^(]+)\((.*)\)$/);
  if (!funcMatch) {
    return trimmed.replace(/\s*,\s*/g, ",").replace(/\s+/g, " ");
  }

  const [, funcName, rawArgs] = funcMatch;
  if (!rawArgs.trim()) {
    return `${funcName.trim().toLowerCase()}()`;
  }

  const args = rawArgs.split(",").map(normalizeFunctionArgument);
  return `${funcName.trim().toLowerCase()}(${args.join(",")})`;
}

export function listArchiveObjectAclIdentities(tocOutput: string): string[] {
  const identities = new Set<string>();

  for (const line of tocOutput.split(/\r?\n/)) {
    const match = line.match(
      /^\s*\d+;\s+\d+\s+\d+\s+ACL\s+(\S+)\s+(TABLE|SEQUENCE|FUNCTION)\s+(.+)\s+(\S+)\s*$/i,
    );
    if (!match) {
      continue;
    }

    const [, schemaName, objectType, rawIdentity] = match;
    identities.add(
      `${schemaName.toLowerCase()} ${objectType.toUpperCase()} ${normalizeArchiveAclIdentity(rawIdentity)}`,
    );
  }

  return [...identities].sort();
}

export function findMissingCriticalArchiveAclEntries(tocOutput: string): string[] {
  const identities = new Set(listArchiveObjectAclIdentities(tocOutput));
  return REQUIRED_DATABASE_ACL_IDENTITIES.filter((identity) => !identities.has(identity));
}

export function countArchiveAclEntries(tocOutput: string): number {
  return tocOutput
    .split(/\r?\n/)
    .filter((line) => PG_RESTORE_ACL_TOC_ENTRY.test(line)).length;
}

export async function verifyDatabaseArchiveAcl(
  archivePath: string,
  execCommand: NonNullable<DatabaseBackupOptions["execCommand"]> = defaultExecCommand,
): Promise<number> {
  const result = await execCommand("pg_restore", ["--list", archivePath], {});

  if (result.exitCode !== 0) {
    throw new Error(
      `pg_restore --list failed with exit code ${result.exitCode}. Rejecting database backup (fail-closed).`,
    );
  }

  const aclEntryCount = countArchiveAclEntries(result.stdout);
  const parsedIdentities = listArchiveObjectAclIdentities(result.stdout);
  const missingCriticalAclEntries = findMissingCriticalArchiveAclEntries(result.stdout);
  const criticalFound = parsedIdentities.filter((id) =>
    (REQUIRED_DATABASE_ACL_IDENTITIES as readonly string[]).includes(id),
  );

  if (aclEntryCount === 0 || missingCriticalAclEntries.length > 0) {
    throw new Error(
      `Database archive is missing critical ACL entries: ${missingCriticalAclEntries.join(
        ", ",
      )} (total ACL entries in TOC: ${aclEntryCount}, critical identities parsed: [${criticalFound.join(
        ", ",
      )}]). Rejecting database backup (fail-closed).`,
    );
  }

  return aclEntryCount;
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

  await verifyDatabaseArchiveAcl(outputPath, execCommand);

  const sha256 = await computeFileSha256(outputPath);

  return {
    filename: "database.dump",
    filePath: outputPath,
    bytes: stats.size,
    sha256,
  };
}
