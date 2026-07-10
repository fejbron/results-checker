import Link from "next/link";
import ForgotPasswordForm from "./forgot-password-form";

export const metadata = { title: "Reset password — Results Checker" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Forgot your password?</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>
        <div className="card">
          <ForgotPasswordForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/admin/login" className="font-medium text-slate-900 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
