import "server-only";

export type AdminErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE_SLUG"
  | "SESSION_EXPIRED"
  | "CSRF_REJECTED"
  | "ADMIN_UNAVAILABLE";

export class AdminError extends Error {
  constructor(
    public readonly code: AdminErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AdminError";
  }
}
