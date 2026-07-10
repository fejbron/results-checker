"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "./auth-actions";

export default function Sidebar() {
  const pathname = usePathname();
  const onDashboard = pathname === "/admin";

  const linkBase =
    "block rounded-xl px-4 py-2.5 text-sm font-medium transition-colors";

  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col py-6 sm:flex">
      <Link href="/admin" className="mb-6 px-4 text-lg font-bold text-slate-900">
        Results Checker
      </Link>

      <nav className="space-y-1">
        <Link
          href="/admin"
          className={`${linkBase} ${
            onDashboard
              ? "bg-blue-50 text-blue-600"
              : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          }`}
        >
          Dashboard
        </Link>
        <Link
          href="/"
          target="_blank"
          className={`${linkBase} text-slate-500 hover:bg-slate-100 hover:text-slate-700`}
        >
          Student site
        </Link>
      </nav>

      <form action={signOut} className="mt-auto px-1">
        <button type="submit" className="btn-secondary w-full">
          Sign out
        </button>
      </form>
    </aside>
  );
}
