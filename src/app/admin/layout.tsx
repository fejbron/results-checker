import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./auth-actions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The login page renders its own full-screen layout. Only wrap in the admin
  // chrome when a lecturer is actually signed in.
  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/admin" className="text-lg font-semibold text-slate-900">
            Results Checker <span className="text-slate-400">· Admin</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-500 sm:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <button type="submit" className="btn-secondary">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
