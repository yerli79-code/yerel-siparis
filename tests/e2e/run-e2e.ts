import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { createMockSupabaseServer, type MockSupabaseServerInstance } from "./mock-supabase-server";

export const MOCK_SERVER_PORT = 4010;
export const NEXT_DEV_PORT = 3100;
export const EXPECTED_MOCK_URL = `http://127.0.0.1:${MOCK_SERVER_PORT}`;
export const DUMMY_PUBLISHABLE_KEY = "sb_publishable_e2e_local_dummy_key_0000000000000000";
export const DUMMY_SERVER_SECRET = "e2e_local_dummy_server_secret_key_000000000000";

export const ALLOWED_SUPABASE_ENV_VARS = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVER_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_BACKUP_SECRET_KEY",
]);

const EXCLUDED_SCAN_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".agents",
  "tests/e2e",
  "docs",
  ".vercel",
]);

export function scanRuntimeSupabaseEnvVars(workspaceRoot: string): Set<string> {
  const discovered = new Set<string>();

  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (EXCLUDED_SCAN_DIRS.has(entry.name) || EXCLUDED_SCAN_DIRS.has(relPath)) {
          continue;
        }
        walk(fullPath);
      } else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name)) {
        // Skip test/spec files and non-runtime review artifacts
        if (
          /\.(test|spec)\.[a-z0-9]+$/i.test(entry.name) ||
          entry.name.includes("review") ||
          entry.name.endsWith(".patch")
        ) {
          continue;
        }

        const content = fs.readFileSync(fullPath, "utf8");

        // 1. Dot notation: process.env.X or envSource.X
        const dotMatches = content.matchAll(/\b(?:process\.env|envSource)\.([A-Za-z0-9_]+)\b/g);
        for (const m of dotMatches) {
          if (m[1].includes("SUPABASE")) discovered.add(m[1]);
        }

        // 2. Bracket notation: process.env['X'] or envSource["X"]
        const bracketMatches = content.matchAll(/\b(?:process\.env|envSource)\[['"]([A-Za-z0-9_]+)['"]\]/g);
        for (const m of bracketMatches) {
          if (m[1].includes("SUPABASE")) discovered.add(m[1]);
        }

        // 3. Literal Supabase tokens: NEXT_PUBLIC_SUPABASE_* or SUPABASE_*
        const literalPublicMatches = content.matchAll(/\b(NEXT_PUBLIC_SUPABASE_[A-Z0-9_]+)\b/g);
        for (const m of literalPublicMatches) {
          discovered.add(m[1]);
        }
        const literalSecretMatches = content.matchAll(/\b(SUPABASE_[A-Z0-9_]+)\b/g);
        for (const m of literalSecretMatches) {
          discovered.add(m[1]);
        }
      }
    }
  }

  walk(workspaceRoot);
  return discovered;
}

export function validateDiscoveredEnvVars(discovered: Set<string>): void {
  const unallowed: string[] = [];
  for (const name of discovered) {
    if (!ALLOWED_SUPABASE_ENV_VARS.has(name)) {
      unallowed.push(name);
    }
  }

  if (unallowed.length > 0) {
    throw new Error(
      `CRITICAL SAFETY ABORT: Unknown Supabase env variable(s) found in runtime code: [${unallowed.join(
        ", ",
      )}]. Not in allowlist!`,
    );
  }
}

export function validateSafeUrl(urlStr: string): void {
  const parsed = new URL(urlStr);
  if (parsed.protocol !== "http:") {
    throw new Error(`CRITICAL SAFETY ABORT: Non-http protocol detected: ${parsed.protocol}`);
  }
  if (
    parsed.hostname.includes("supabase.co") ||
    parsed.hostname.includes("yerelsiparis.com") ||
    urlStr.includes("supabase.co") ||
    urlStr.includes("yerelsiparis.com")
  ) {
    throw new Error(`CRITICAL SAFETY ABORT: Hosted domain target detected: ${urlStr}`);
  }
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error(`CRITICAL SAFETY ABORT: Non-loopback hostname detected: ${parsed.hostname}`);
  }
}

export const ALLOWED_PARENT_SYSTEM_ENV_VARS = new Set([
  // Windows runtime & system variables
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "SYSTEMDRIVE",
  // POSIX standard runtime variables (for cross-platform compatibility)
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TERM",
]);

export function createSanitizedChildEnv(
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  // Copy ONLY variables matching the explicit minimal system allowlist
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();
    if (ALLOWED_PARENT_SYSTEM_ENV_VARS.has(upperKey)) {
      sanitized[key] = value;
    }
  }

  // Explicitly inject ONLY safe local loopback values & synthetic Supabase application variables
  sanitized.NODE_ENV = "development";
  sanitized.PORT = String(NEXT_DEV_PORT);
  sanitized.NO_PROXY = "127.0.0.1,localhost";
  sanitized.NEXT_TELEMETRY_DISABLED = "1";

  sanitized.NEXT_PUBLIC_SUPABASE_URL = EXPECTED_MOCK_URL;
  sanitized.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = DUMMY_PUBLISHABLE_KEY;
  sanitized.SUPABASE_SERVER_SECRET_KEY = DUMMY_SERVER_SECRET;
  sanitized.NEXT_PUBLIC_SUPABASE_ANON_KEY = "e2e_local_dummy_anon_key";
  sanitized.SUPABASE_SERVICE_ROLE_KEY = "e2e_local_dummy_service_role_key";
  sanitized.SUPABASE_DB_URL = "postgresql://postgres:dummy@127.0.0.1:5432/dummy";
  sanitized.SUPABASE_URL = EXPECTED_MOCK_URL;
  sanitized.SUPABASE_BACKUP_SECRET_KEY = "e2e_local_dummy_backup_secret";

  return sanitized;
}

export function validateEffectiveChildEnv(env: Record<string, string>): void {
  const publicUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!publicUrl || !publicUrl.startsWith("http://127.0.0.1:")) {
    throw new Error(`CRITICAL SAFETY ABORT: NEXT_PUBLIC_SUPABASE_URL is not loopback 127.0.0.1: ${publicUrl}`);
  }

  const serverUrl = env.SUPABASE_URL;
  if (!serverUrl || !serverUrl.startsWith("http://127.0.0.1:")) {
    throw new Error(`CRITICAL SAFETY ABORT: SUPABASE_URL is not loopback 127.0.0.1: ${serverUrl}`);
  }

  const dbUrl = env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error("CRITICAL SAFETY ABORT: SUPABASE_DB_URL is missing");
  }
  const dbParsed = new URL(dbUrl);
  if (dbParsed.hostname !== "127.0.0.1" && dbParsed.hostname !== "localhost") {
    throw new Error(`CRITICAL SAFETY ABORT: SUPABASE_DB_URL is not loopback: ${dbParsed.hostname}`);
  }

  for (const [key, value] of Object.entries(env)) {
    if (key.includes("SUPABASE")) {
      if (value.includes("supabase.co") || value.includes("yerelsiparis.com")) {
        throw new Error(`CRITICAL SAFETY ABORT: Hosted domain detected in ${key}: ${value}`);
      }
    }
  }
}

async function waitForEndpoint(url: string, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (res.ok || res.status === 200) return true;
    } catch {
      // Retry after backoff
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function killProcessTree(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!child.pid) {
      resolve();
      return;
    }

    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    } else {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore
      }
      resolve();
    }
  });
}

export async function runE2EHarness(options: { smokeOnly?: boolean } = {}) {
  const root = path.resolve(".");
  console.log("[E2E Runner] 1. Scanning runtime code for Supabase environment variables...");
  const discovered = scanRuntimeSupabaseEnvVars(root);
  console.log(`[E2E Runner] Discovered: [${Array.from(discovered).join(", ")}]`);

  console.log("[E2E Runner] 2. Validating discovered variables against allowlist...");
  validateDiscoveredEnvVars(discovered);
  console.log("[E2E Runner] Allowlist check PASSED.");

  console.log("[E2E Runner] 3. Validating target URL safety...");
  validateSafeUrl(EXPECTED_MOCK_URL);
  console.log("[E2E Runner] Target URL safety check PASSED.");

  console.log("[E2E Runner] 4. Building sanitized child environment...");
  const sanitizedEnv = createSanitizedChildEnv(process.env);
  validateEffectiveChildEnv(sanitizedEnv);
  console.log("[E2E Runner] Effective environment validation PASSED.");

  console.log(`[E2E Runner] 5. Starting loopback mock Supabase server on 127.0.0.1:${MOCK_SERVER_PORT}...`);
  let mockInstance: MockSupabaseServerInstance;
  try {
    mockInstance = await createMockSupabaseServer(MOCK_SERVER_PORT);
  } catch (err) {
    console.error("[E2E Runner] Failed to start mock server:", err);
    process.exit(1);
  }

  console.log(`[E2E Runner] Mock server listening at ${mockInstance.baseUrl}`);

  console.log(`[E2E Runner] 6. Starting Next.js dev server on 127.0.0.1:${NEXT_DEV_PORT}...`);
  const nextCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const nextArgs = ["next", "dev", "-p", String(NEXT_DEV_PORT), "-H", "127.0.0.1"];

  const nextProcess: ChildProcess = spawn(nextCmd, nextArgs, {
    cwd: root,
    env: sanitizedEnv as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  nextProcess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.includes("Ready in") || text.includes("ready") || text.includes("started server on")) {
      console.log(`[Next.js] ${text.trim()}`);
    }
  });

  nextProcess.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (!text.includes("punycode") && text.trim()) {
      console.warn(`[Next.js stderr] ${text.trim()}`);
    }
  });

  let isShuttingDown = false;
  async function shutdown(exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\n[E2E Runner] Shutting down servers...");
    try {
      await killProcessTree(nextProcess);
      await mockInstance.close();
      console.log("[E2E Runner] Clean shutdown complete.");
    } catch (err) {
      console.error("[E2E Runner] Error during shutdown:", err);
    }
    process.exit(exitCode);
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  console.log("[E2E Runner] 7. Awaiting health checks on mock and Next.js dev servers...");
  const mockHealthy = await waitForEndpoint(`http://127.0.0.1:${MOCK_SERVER_PORT}/__e2e/health`, 10_000);
  if (!mockHealthy) {
    console.error("[E2E Runner] Mock server health check failed!");
    await shutdown(1);
    return;
  }

  const nextHealthy = await waitForEndpoint(`http://127.0.0.1:${NEXT_DEV_PORT}/giris`, 30_000);
  if (!nextHealthy) {
    console.error("[E2E Runner] Next.js dev server failed to respond on /giris!");
    await shutdown(1);
    return;
  }

  console.log("\n==================================================");
  console.log("E2E_LOCAL_ENV_READY");
  console.log(`Mock Supabase: http://127.0.0.1:${MOCK_SERVER_PORT}`);
  console.log(`Next.js Dev:   http://127.0.0.1:${NEXT_DEV_PORT}`);
  console.log("==================================================\n");

  if (options.smokeOnly) {
    console.log("[E2E Runner] Performing smoke test on http://127.0.0.1:3100/giris...");
    const res = await fetch(`http://127.0.0.1:${NEXT_DEV_PORT}/giris`);
    const html = await res.text();
    if (res.status === 200 && (html.includes("Giriş") || html.includes("giris") || html.includes("E-posta"))) {
      console.log("[E2E Runner] Smoke verification SUCCESSFUL. Local /giris rendered correctly.");
    } else {
      console.error("[E2E Runner] Smoke verification FAILED: Unexpected response status or body.", res.status);
      await shutdown(1);
      return;
    }

    console.log("[E2E Runner] Smoke test complete. Shutting down.");
    await shutdown(0);
    return;
  }

  console.log("[E2E Runner] Harness is running. Press Ctrl+C to stop.");
}

// When executed directly from CLI
if (process.argv[1] && process.argv[1].endsWith("run-e2e.ts")) {
  const isSmoke = process.argv.includes("--smoke");
  runE2EHarness({ smokeOnly: isSmoke }).catch((err) => {
    console.error("[E2E Runner] Fatal error:", err);
    process.exit(1);
  });
}
