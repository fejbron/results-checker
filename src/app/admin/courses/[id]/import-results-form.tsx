"use client";

import { useActionState, useState } from "react";
import { importResults, type ActionState } from "../../actions";

const initial: ActionState = { error: null };

// Quote a CSV field if it contains a comma, quote, or newline.
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Build a template CSV: header = index + this course's column labels, then one
// blank-score row per enrolled student (index filled, score cells empty).
function buildTemplate(columns: string[], students: { index_number: string }[]): string {
  const header = ["index", ...columns].map(csvField).join(",");
  const trailing = ",".repeat(columns.length); // one empty cell per column
  const rows = students.map((s) => csvField(s.index_number) + trailing);
  return [header, ...rows].join("\n") + "\n";
}

export default function ImportResultsForm({
  courseId,
  columns,
  students,
}: {
  courseId: string;
  columns: string[];
  students: { index_number: string }[];
}) {
  const [state, action, pending] = useActionState(importResults, initial);
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

  const downloadTemplate = () => {
    const csv = buildTemplate(columns, students);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "results-template.csv";
    a.click();
    URL.revokeObjectURL(url);
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
          className="font-medium text-slate-700 underline hover:text-slate-900"
        >
          Download template
        </button>{" "}
        — a CSV with this course&apos;s columns and enrolled students, ready to
        fill in.
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
