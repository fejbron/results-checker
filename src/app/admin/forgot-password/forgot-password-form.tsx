"use client";

import { useActionState } from "react";
import { requestPasswordReset, type AuthState } from "../auth-actions";

const initial: AuthState = { error: null };

export default function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);

  if (state.ok) {
    return (
      <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
        If an account exists for that email, a reset link is on its way. Check
        your inbox.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-4">
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
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{state.error}</p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
