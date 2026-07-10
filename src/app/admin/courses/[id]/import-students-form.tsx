"use client";

import { useActionState, useState } from "react";
import { importStudents, type ActionState } from "../../actions";

const initial: ActionState = { error: null };

export default function ImportStudentsForm({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(importStudents, initial);
  const [open, setOpen] = useState(false);

  // Collapse on a clean success. Collapsing unmounts the form, so its inputs
  // reset naturally on the next open (adjust-state-during-render pattern).
  const [wasOk, setWasOk] = useState(false);
  if (state.ok && !wasOk) {
    setWasOk(true);
    setOpen(false);
  } else if (!state.ok && wasOk) {
    setWasOk(false);
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary">
          Import from CSV
        </button>
        {state.ok && <span className="text-sm text-green-600">Import complete ✓</span>}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="courseId" value={courseId} />
      <p className="text-sm text-slate-600">
        One student per line: <code>index number, full name, PIN</code>. The PIN
        is optional (defaults to the last 4 digits of the index number). A header
        row is detected and skipped automatically.
      </p>
      <textarea
        name="csv"
        rows={5}
        className="input font-mono text-xs"
        placeholder={"UEB0101220, Ama Mensah, 1220\nUEB0101221, Kofi Boateng"}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-500">
          …or upload a file:{" "}
          <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Importing…" : "Import students"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
          Cancel
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
