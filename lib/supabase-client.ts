import { isSupabasePublishableKey } from "./supabase-publishable-key";
import { createClient } from "@supabase/supabase-js";

const verifierKey = "yerel-siparis-recovery-code-verifier";

export function createBrowserSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !isSupabasePublishableKey(publishableKey)) {
    throw new Error(
      ".env.local içinde NEXT_PUBLIC_SUPABASE_URL veya NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY eksik.",
    );
  }

  // Only the PKCE verifier survives navigation. Recovery sessions are private
  // to this client, never read from the legacy SDK or business/admin stores.
  const memory = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return key.endsWith("-code-verifier") && typeof window !== "undefined"
        ? window.localStorage.getItem(verifierKey)
        : memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (key.endsWith("-code-verifier") && typeof window !== "undefined") {
        window.localStorage.setItem(verifierKey, value);
      } else memory.set(key, value);
    },
    removeItem(key: string) {
      if (key.endsWith("-code-verifier") && typeof window !== "undefined") {
        window.localStorage.removeItem(verifierKey);
      } else memory.delete(key);
    },
  };
  const client = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: true,
      flowType: "pkce",
      storageKey: `yerel-siparis-recovery-${crypto.randomUUID()}`,
      storage,
    },
  });
  return Object.assign(client, {
    discardRecoverySession() {
      memory.clear();
      void client.auth.dispose();
    },
  });
}
