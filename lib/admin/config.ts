import "server-only";

import { AdminError } from "./errors";

export function getSupabasePublicServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Admin servisi yapılandırılamadı.",
      503,
    );
  }

  return { url, anonKey };
}

export function getSupabaseAdminServerConfig() {
  const { url, anonKey } = getSupabasePublicServerConfig();
  const serverSecretKey = process.env.SUPABASE_SERVER_SECRET_KEY;

  if (!serverSecretKey) {
    throw new AdminError(
      "ADMIN_UNAVAILABLE",
      "Admin servisi yapılandırılamadı.",
      503,
    );
  }

  return { url, anonKey, serverSecretKey };
}
