"use client";

import { useActionState, useEffect, useRef } from "react";
import { addColumn, type ActionState } from "../../actions";

const initial: ActionState = { error: null };

export default function AddColumnForm({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(addColumn, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="courseId" value={courseId} />
      <div className="flex-1">
        <label className="label" htmlFor="label">
          Column label
        </label>
        <input id="label" name="label" className="input" placeholder="Assignment 1" required />
      </div>
      <div className="sm:w-36">
        <label className="label" htmlFor="max_score">
          Max score
        </label>
        <input
          id="max_score"
          name="max_score"
          type="number"
          min="1"
          step="any"
          defaultValue={100}
          className="input"
          required
        />
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Adding…" : "Add column"}
      </button>
      {state.error && <p className="text-sm text-red-600 sm:self-center">{state.error}</p>}
    </form>
  );
}
