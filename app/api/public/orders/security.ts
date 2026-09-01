import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const PUBLIC_ORDER_BODY_LIMIT_BYTES = 16 * 1024;
export const PUBLIC_ORDER_ROUTE = "/api/public/orders";
export const RATE_LIMIT_UNAVAILABLE_RETRY_SECONDS = 30;

export class PublicOrderPayloadTooLargeError extends Error {}

export type PublicOrderRateLimitResult = {
  allowed: boolean;
  blockedDimension: "ip" | "business" | null;
  retryAfterSeconds: number;
};

type SecurityEvent =
  | {
      event: "public_order_payload_too_large";
      route: typeof PUBLIC_ORDER_ROUTE;
    }
  | {
      event: "public_order_rate_limit_blocked";
      limiterDimension: "ip" | "business";
      route: typeof PUBLIC_ORDER_ROUTE;
      retryAfterSeconds: number;
      ipFingerprint: string;
      businessSlug: string;
    }
  | {
      event: "public_order_rate_limit_unavailable";
      route: typeof PUBLIC_ORDER_ROUTE;
      retryAfterSeconds: number;
    };

export function logPublicOrderSecurityEvent(event: SecurityEvent) {
  console.warn(JSON.stringify(event));
}

function contentLengthExceedsLimit(value: string | null, limit: number) {
  if (!value || !/^\d+$/.test(value.trim())) return false;
  const contentLength = Number(value);
  return !Number.isSafeInteger(contentLength) || contentLength > limit;
}

export async function readPublicOrderBody(
  request: Request,
  limit = PUBLIC_ORDER_BODY_LIMIT_BYTES,
) {
  if (contentLengthExceedsLimit(request.headers.get("content-length"), limit)) {
    throw new PublicOrderPayloadTooLargeError();
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        await reader.cancel();
        throw new PublicOrderPayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function canonicalizeIp(value: string) {
  const trimmed = value.trim();
  const version = isIP(trimmed);
  if (version === 4) return trimmed;
  if (version !== 6) return null;

  try {
    const hostname = new URL(`http://[${trimmed}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return null;
  }
}

export function getTrustedVercelClientIp(request: Request) {
  const platformValue = request.headers.get("x-vercel-forwarded-for");
  if (!platformValue || platformValue.includes(",")) return null;
  return canonicalizeIp(platformValue);
}

export function createPublicOrderIpFingerprint(
  clientIp: string | null,
  serviceRoleKey: string,
) {
  return createHmac("sha256", serviceRoleKey)
    .update(`public-order-ip:v1:${clientIp ?? "unavailable"}`)
    .digest("hex");
}

export function normalizeRateLimitBusinessSlug(value: string) {
  const normalized = value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replaceAll("ç", "c")
    .replaceAll("ğ", "g")
    .replaceAll("ı", "i")
    .replaceAll("ö", "o")
    .replaceAll("ş", "s")
    .replaceAll("ü", "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "invalid-slug";
}

function parseRateLimitResult(value: unknown): PublicOrderRateLimitResult {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Invalid rate-limit response.");
  }

  const record = row as Record<string, unknown>;
  const allowed = record.allowed;
  const blockedDimension = record.blocked_dimension;
  const retryAfterSeconds = Number(record.retry_after_seconds);
  if (
    typeof allowed !== "boolean" ||
    (blockedDimension !== null &&
      blockedDimension !== "ip" &&
      blockedDimension !== "business") ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 0
  ) {
    throw new Error("Invalid rate-limit response.");
  }

  if (allowed && (blockedDimension !== null || retryAfterSeconds !== 0)) {
    throw new Error("Invalid rate-limit response.");
  }
  if (!allowed && (blockedDimension === null || retryAfterSeconds < 1)) {
    throw new Error("Invalid rate-limit response.");
  }

  return { allowed, blockedDimension, retryAfterSeconds };
}

export async function checkPublicOrderRateLimit(
  url: string,
  serviceRoleKey: string,
  input: { ipFingerprint: string; businessSlug: string },
) {
  const response = await fetch(
    `${url}/rest/v1/rpc/check_public_order_rate_limit`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_ip_fingerprint: input.ipFingerprint,
        p_business_slug: input.businessSlug,
      }),
    },
  );

  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Invalid rate-limit response.");
  }

  if (!response.ok) {
    throw new Error("Rate-limit store unavailable.");
  }

  return parseRateLimitResult(body);
}
