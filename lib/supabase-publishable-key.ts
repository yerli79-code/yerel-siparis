// Shared browser/server shape check. Never include the supplied value in errors.
export function isSupabasePublishableKey(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && /^sb_publishable_[A-Za-z0-9_-]+$/.test(value);
}
