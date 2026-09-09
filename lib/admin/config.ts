import "server-only";

import { isSupabasePublishableKey } from "../supabase-publishable-key";

import { AdminError } from "./errors";

export function getSupabasePublicServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !isSupabasePublishableKey(publishableKey)) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Admin servisi yapılandırılamadı.",
      503,
    );
  }

  return { url, publishableKey };
}

export function getSupabaseAdminServerConfig() {
  const { url, publishableKey } = getSupabasePublicServerConfig();
  const serverSecretKey = process.env.SUPABASE_SERVER_SECRET_KEY;

  if (!serverSecretKey) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Admin servisi yapılandırılamadı.",
      503,
    );
  }

  return { url, publishableKey, serverSecretKey };
}
