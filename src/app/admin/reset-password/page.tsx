import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordForm from "./reset-password-form";

export const metadata = { title: "Choose a new password — Results Checker" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Choose a new password</h1>
          {user?.email && (
            <p className="mt-1 text-sm text-slate-500">for {user.email}</p>
          )}
        </div>
        <div className="card">
          {user ? (
            <ResetPasswordForm />
          ) : (
            <div className="space-y-4 text-sm text-slate-600">
              <p>
                This reset link is invalid or has expired. Please request a new
                one.
              </p>
              <Link href="/admin/forgot-password" className="btn-primary w-full">
                Request a new link
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
