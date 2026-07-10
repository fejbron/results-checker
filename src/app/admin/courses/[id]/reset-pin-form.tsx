"use client";

import { useActionState, useState } from "react";
import { resetPin, type ActionState } from "../../actions";

const initial: ActionState = { error: null };

export default function ResetPinForm({
  courseId,
  studentId,
}: {
  courseId: string;
  studentId: string;
}) {
  const [state, action, pending] = useActionState(resetPin, initial);
  const [open, setOpen] = useState(false);

  // Collapse the form the moment a save succeeds. Adjusting state during render
  // (rather than in an effect) is the React-recommended pattern for reacting to
  // a changed value and avoids cascading re-renders.
  const [wasOk, setWasOk] = useState(false);
  if (state.ok && !wasOk) {
    setWasOk(true);
    setOpen(false);
  } else if (!state.ok && wasOk) {
    setWasOk(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-indigo-600 hover:underline"
      >
        {state.ok ? "PIN updated ✓" : "Reset PIN"}
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="studentId" value={studentId} />
      <input
        name="pin"
        className="input w-28 py-1"
        placeholder="New PIN"
        autoFocus
        required
      />
      <button type="submit" className="text-sm text-indigo-600 hover:underline" disabled={pending}>
        {pending ? "…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-sm text-slate-400 hover:underline"
      >
        Cancel
      </button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
