"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, type AuthState } from "../auth-actions";

const initialState: AuthState = { error: null };

export default function LoginForm() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/admin";
  const urlError = searchParams.get("error");
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const error = state.error ?? urlError;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="redirect" value={redirect} />
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="input"
          placeholder="lecturer@school.edu"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          placeholder="••••••••"
        />
        <div className="mt-1 text-right">
          <Link
            href="/admin/forgot-password"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
