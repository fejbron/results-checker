import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client. BYPASSES Row Level Security — only ever import
// this from server-only code (Server Actions / Route Handlers), never from a
// component that ships to the browser. Used for the student results lookup,
// which has no auth session, after the PIN has been verified server-side.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
