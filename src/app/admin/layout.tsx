import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "./sidebar";

// Auth pages render their own full-screen layout and must not get the
// dashboard chrome (which would also nest a second <main>).
const STANDALONE_PATHS = [
  "/admin/login",
  "/admin/forgot-password",
  "/admin/reset-password",
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (STANDALONE_PATHS.includes(pathname)) {
    return <>{children}</>;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fallback: if somehow unauthenticated here, render bare (proxy will redirect).
  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] gap-4 px-4">
      <Sidebar />
      <main className="min-w-0 flex-1 py-6">{children}</main>
    </div>
  );
}
