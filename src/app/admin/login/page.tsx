import { Suspense } from "react";
import Link from "next/link";
import LoginForm from "./login-form";

export const metadata = { title: "Admin sign in — Results Checker" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Lecturer sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter your credentials to manage results.
          </p>
        </div>
        <div className="card">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          Are you a student?{" "}
          <Link href="/" className="font-medium text-indigo-600 hover:underline">
            Check your results
          </Link>
        </p>
      </div>
    </main>
  );
}
