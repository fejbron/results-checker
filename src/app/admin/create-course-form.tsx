"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCourse, type ActionState } from "./actions";

const initial: ActionState = { error: null };

export default function CreateCourseForm() {
  const [state, action, pending] = useActionState(createCourse, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="card flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <label className="label" htmlFor="name">
          Course name
        </label>
        <input id="name" name="name" className="input" placeholder="Introduction to Biology" required />
      </div>
      <div className="sm:w-48">
        <label className="label" htmlFor="code">
          Course code
        </label>
        <input id="code" name="code" className="input" placeholder="BIO 101" required />
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Creating…" : "Add course"}
      </button>
      {state.error && (
        <p className="text-sm text-red-600 sm:self-center">{state.error}</p>
      )}
    </form>
  );
}
