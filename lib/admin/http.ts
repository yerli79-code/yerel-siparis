import "server-only";

import { NextResponse } from "next/server";
import { AdminError, type AdminErrorCode } from "./errors";
import { isSameOriginAdminRequest } from "./same-origin";

const ADMIN_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;

export function adminJson<T>(body: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(ADMIN_CACHE_HEADERS)) {
    headers.set(name, value);
  }

  return NextResponse.json(body, { ...init, headers });
}

export function adminErrorResponse(
  error: unknown,
  fallbackMessage = "Admin işlemi şu anda tamamlanamıyor.",
) {
  const controlled =
    error instanceof AdminError
      ? error
      : new AdminError("ADMIN_UNAVAILABLE", fallbackMessage, 503);

  return adminJson(
    {
      error: {
        code: controlled.code,
        message: controlled.message,
      },
    },
    { status: controlled.status },
  );
}

export function invalidAdminRequest(message: string): never {
  throw new AdminError("INVALID_REQUEST", message, 400);
}

export function assertSameOriginAdminMutation(request: Request) {
  if (!isSameOriginAdminRequest(request)) {
    throw new AdminError(
      "CSRF_REJECTED",
      "İstek kaynağı doğrulanamadı.",
      403,
    );
  }
}

export function isAdminErrorCode(value: unknown): value is AdminErrorCode {
  return (
    typeof value === "string" &&
    [
      "UNAUTHORIZED",
      "FORBIDDEN",
      "INVALID_REQUEST",
      "NOT_FOUND",
      "CONFLICT",
      "INVALID_STATE",
      "DUPLICATE_SLUG",
      "SESSION_EXPIRED",
      "CSRF_REJECTED",
      "ADMIN_UNAVAILABLE",
    ].includes(value)
  );
}
