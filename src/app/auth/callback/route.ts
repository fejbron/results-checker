import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the link from Supabase auth emails (e.g. password recovery).
// Exchanges the one-time code for a session cookie, then forwards the user on.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  // Only ever forward to a path on this origin. `origin + next` with a value
  // like "@evil.com" resolves to https://<origin>@evil.com — the host is then
  // evil.com and the origin is just userinfo, i.e. an open redirect. "//host"
  // is the protocol-relative variant of the same trick.
  const requestedNext = searchParams.get("next") ?? "/admin";
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/admin";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/admin/login?error=${encodeURIComponent("Invalid or expired link.")}`,
  );
}
