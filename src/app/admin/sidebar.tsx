"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, LayoutGrid, ExternalLink, LogOut } from "lucide-react";
import { signOut } from "./auth-actions";

export default function Sidebar() {
  const pathname = usePathname();
  const onDashboard = pathname === "/admin";

  return (
    <aside className="sticky top-0 flex h-screen w-20 shrink-0 flex-col items-center gap-2 py-6">
      {/* Brand mark */}
      <Link
        href="/admin"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-600/30"
        title="Results Checker"
      >
        <GraduationCap className="h-6 w-6" />
      </Link>

      <Link
        href="/admin"
        className={`nav-item ${onDashboard ? "nav-item-active" : ""}`}
        title="Dashboard"
      >
        <LayoutGrid className="h-5 w-5" />
      </Link>

      <Link href="/" className="nav-item" title="View student site" target="_blank">
        <ExternalLink className="h-5 w-5" />
      </Link>

      <form action={signOut} className="mt-auto">
        <button type="submit" className="nav-item" title="Sign out">
          <LogOut className="h-5 w-5" />
        </button>
      </form>
    </aside>
  );
}
