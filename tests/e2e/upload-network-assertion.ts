import type { NetworkLogEntry } from "./browser-cdp-helper";

export interface UploadEvidence {
  network: NetworkLogEntry[];
  serverRequests: Array<{ method: string; pathname: string }>;
  formSuccess: boolean;
  publicImageUrl: string;
}

function header(headers: Record<string, string> | undefined, name: string): string {
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? "";
}

export function assessUpload(evidence: UploadEvidence) {
  const failures: string[] = [];
  const upload = evidence.network.find((n) => n.method === "POST" &&
    n.url.startsWith("http://127.0.0.1:4010/storage/v1/object/product-images/"));
  const preflight = upload && evidence.network.find((n) => n.method === "OPTIONS" && n.url === upload.url &&
    n.initiatorRequestId === upload.requestId);
  if (!upload) failures.push("Expected POST to product-images not found");
  if (!preflight || !preflight.finished || preflight.failure ||
    preflight.status === undefined || preflight.status < 200 || preflight.status >= 300) {
    failures.push("Preflight did not complete successfully");
  }
  if (preflight) {
    const origin = header(preflight.responseHeaders, "access-control-allow-origin");
    const methods = header(preflight.responseHeaders, "access-control-allow-methods").toUpperCase().split(/\s*,\s*/);
    const allowed = header(preflight.responseHeaders, "access-control-allow-headers").toLowerCase().split(/\s*,\s*/);
    const requested = header(preflight.requestHeaders, "access-control-request-headers").toLowerCase().split(/\s*,\s*/).filter(Boolean);
    if (!["*", "http://127.0.0.1:3100"].includes(origin) || !methods.includes("POST") ||
      !requested.includes("x-upsert") || !requested.every((name) => allowed.includes(name))) {
      failures.push("Preflight CORS origin/method/headers invalid");
    }
  }
  if (!upload?.finished || upload.failure || upload.status === undefined || upload.status < 200 || upload.status >= 300) {
    failures.push("Final upload did not complete with a successful HTTP response");
  }
  const pathname = upload ? new URL(upload.url).pathname : "";
  const optionsIndex = evidence.serverRequests.findIndex((n) => n.method === "OPTIONS" && n.pathname === pathname);
  const postIndex = evidence.serverRequests.findIndex((n) => n.method === "POST" && n.pathname === pathname);
  if (optionsIndex < 0 || postIndex <= optionsIndex) failures.push("Mock did not receive OPTIONS followed by final POST");
  const expectedPublicUrl = upload?.url.replace("/storage/v1/object/", "/storage/v1/object/public/");
  if (!evidence.formSuccess || !expectedPublicUrl || evidence.publicImageUrl !== expectedPublicUrl) {
    failures.push("Form did not reach success with the uploaded public image URL");
  }
  return { status: failures.length ? "FAIL" as const : "PASS" as const, failures, upload, preflight };
}
