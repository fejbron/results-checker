"use client";

import { useActionState } from "react";
import { lookupResults, type LookupState } from "./student-actions";
import type { CourseResult } from "@/lib/types";

const initial: LookupState = { error: null };

export default function ResultsChecker() {
  const [state, action, pending] = useActionState(lookupResults, initial);
  const showResults = state.results !== undefined;

  return (
    <div className="space-y-6">
      <form action={action} className="card">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="index_number">
              Index number
            </label>
            <input
              id="index_number"
              name="index_number"
              className="input"
              placeholder="UEB0101220"
              autoComplete="off"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="pin">
              PIN
            </label>
            <input
              id="pin"
              name="pin"
              type="password"
              className="input"
              placeholder="••••"
              required
            />
          </div>
        </div>
        {state.error && (
          <p className="mt-4 rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button type="submit" className="btn-primary mt-4 w-full" disabled={pending}>
          {pending ? "Checking…" : "View my results"}
        </button>
      </form>

      {showResults && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-1">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
              {(state.studentName ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <p className="text-xs text-slate-400">Results for</p>
              <h2 className="font-semibold text-slate-900">{state.studentName}</h2>
            </div>
          </div>

          {state.results!.length === 0 ? (
            <div className="card py-10 text-center text-sm text-slate-500">
              You are not enrolled in any courses yet.
            </div>
          ) : (
            state.results!.map((result) => <CourseCard key={result.courseId} result={result} />)
          )}
        </div>
      )}
    </div>
  );
}

function CourseCard({ result }: { result: CourseResult }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {result.courseCode}
          </p>
          <h3 className="text-base font-semibold text-slate-900">{result.courseName}</h3>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-right">
          <div className="text-lg font-bold leading-none text-slate-900">
            {result.percentage}%
          </div>
          <div className="text-xs text-slate-400">
            {result.mark} / {result.outOf}
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {result.columns.map((c, i) => (
          <li
            key={i}
            className="flex items-center justify-between rounded-md bg-slate-50 px-4 py-2.5"
          >
            <span className="text-sm text-slate-600">{c.label}</span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {c.value === null ? "—" : c.value}{" "}
              <span className="font-normal text-slate-400">/ {c.maxScore}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
