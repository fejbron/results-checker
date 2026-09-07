"use client";

import { useActionState, useState } from "react";
import { importResults, buildResultsTemplate, type ActionState } from "../../actions";
import { downloadCsv } from "@/lib/csv";

const initial: ActionState = { error: null };

export default function ImportResultsForm({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(importResults, initial);
  const [open, setOpen] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  // Collapse on a clean success. Collapsing unmounts the form, so its inputs
  // reset naturally on the next open (adjust-state-during-render pattern).
  const [wasOk, setWasOk] = useState(false);
  if (state.ok && !wasOk) {
    setWasOk(true);
    setOpen(false);
  } else if (!state.ok && wasOk) {
    setWasOk(false);
  }

  // Built on the server so the template lists every enrolled student, not just
  // the page currently on screen.
  const downloadTemplate = async () => {
    setBuilding(true);
    setTemplateError(null);
    try {
      const res = await buildResultsTemplate(courseId);
      if (res.error || !res.csv || !res.filename) {
        setTemplateError(res.error ?? "Could not build the template.");
        return;
      }
      downloadCsv(res.filename, res.csv);
    } catch {
      setTemplateError("Could not build the template.");
    } finally {
      setBuilding(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary">
          Import results from CSV
        </button>
        {state.ok && <span className="text-sm text-green-600">Import complete ✓</span>}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="courseId" value={courseId} />
      <p className="text-sm text-slate-600">
        First column is the student <code>index number</code>; each remaining
        column header must match one of this course&apos;s score columns by name.
        Only blank cells are filled — existing scores are kept. Unknown headers
        and unknown index numbers are skipped and reported.
      </p>
      <p className="text-sm text-slate-500">
        <button
          type="button"
          onClick={downloadTemplate}
          disabled={building}
          className="font-medium text-slate-700 underline hover:text-slate-900 disabled:opacity-50"
        >
          {building ? "Preparing…" : "Download template"}
        </button>{" "}
        — a CSV with this course&apos;s columns and every enrolled student,
        ready to fill in.
        {templateError && (
          <span className="ml-2 text-red-600">{templateError}</span>
        )}
      </p>
      <textarea
        name="csv"
        rows={5}
        className="input font-mono text-xs"
        placeholder={"index, Assignment, Exam\nUEB0101220, 18, 62\nUEB0101221, 15, 55"}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-500">
          …or upload a file:{" "}
          <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Importing…" : "Import results"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
          Cancel
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
