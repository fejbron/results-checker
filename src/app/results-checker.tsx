"use client";

import { useActionState } from "react";
import { lookupResults, type LookupState } from "./student-actions";
import type { CourseResult } from "@/lib/types";

const initial: LookupState = { error: null };

export default function ResultsChecker() {
  const [state, action, pending] = useActionState(lookupResults, initial);
  const showResults = state.results !== undefined;

  return (
    <div className="space-y-8">
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
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}
        <button type="submit" className="btn-primary mt-4 w-full" disabled={pending}>
          {pending ? "Checking…" : "View my results"}
        </button>
      </form>

      {showResults && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Results for {state.studentName}
          </h2>
          {state.results!.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              You are not enrolled in any courses yet.
            </p>
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
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">
            {result.courseCode}
          </p>
          <h3 className="text-lg font-semibold text-slate-900">{result.courseName}</h3>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-slate-900">{result.grade}</div>
          <div className="text-sm text-slate-500">{result.percentage}%</div>
        </div>
      </div>

      <table className="mt-4 w-full text-left text-sm">
        <tbody>
          {result.columns.map((c, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-2 text-slate-600">{c.label}</td>
              <td className="py-2 text-right tabular-nums text-slate-900">
                {c.value === null ? "—" : c.value} / {c.maxScore}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-200 font-semibold">
            <td className="py-2 text-slate-900">Total</td>
            <td className="py-2 text-right tabular-nums text-slate-900">
              {result.total} / {result.maxTotal}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
