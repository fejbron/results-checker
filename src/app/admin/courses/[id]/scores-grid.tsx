"use client";

import { useActionState, useState } from "react";
import { saveScores, type ActionState } from "../../actions";
import { computeResult } from "@/lib/grades";

type Col = { id: string; label: string; maxScore: number };
type Student = { id: string; index_number: string; full_name: string };

const initial: ActionState = { error: null };

export default function ScoresGrid({
  courseId,
  columns,
  students,
  scoreMap,
  overallScore,
}: {
  courseId: string;
  columns: Col[];
  students: Student[];
  scoreMap: Record<string, Record<string, number>>;
  overallScore: number | null;
}) {
  const [state, action, pending] = useActionState(saveScores, initial);

  // Local mirror of the entered values so totals/grades update as you type.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of students) {
      for (const c of columns) {
        const v = scoreMap[s.id]?.[c.id];
        init[`${s.id}__${c.id}`] = v === undefined ? "" : String(v);
      }
    }
    return init;
  });

  const rowResult = (studentId: string) =>
    computeResult(
      columns.map((c) => {
        const raw = values[`${studentId}__${c.id}`];
        return { maxScore: c.maxScore, value: raw === "" ? null : Number(raw) };
      }),
      overallScore,
    );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="courseId" value={courseId} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-4 font-medium">Student</th>
              {columns.map((c) => (
                <th key={c.id} className="py-2 pr-3 font-medium">
                  {c.label}
                  <span className="block text-xs font-normal text-slate-400">
                    / {c.maxScore}
                  </span>
                </th>
              ))}
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => {
              const r = rowResult(s.id);
              return (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4">
                    <div className="font-medium text-slate-800">{s.full_name}</div>
                    <div className="font-mono text-xs text-slate-400">
                      {s.index_number}
                    </div>
                  </td>
                  {columns.map((c) => {
                    const key = `${s.id}__${c.id}`;
                    return (
                      <td key={c.id} className="py-1 pr-3">
                        <input
                          name={`score__${key}`}
                          value={values[key] ?? ""}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [key]: e.target.value }))
                          }
                          type="number"
                          min="0"
                          max={c.maxScore}
                          step="any"
                          className="input w-20 py-1"
                        />
                      </td>
                    );
                  })}
                  <td className="py-2 text-right tabular-nums">
                    {r.mark} / {r.outOf}
                    <span className="block text-xs text-slate-400">
                      {r.percentage}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save results"}
        </button>
        {state.ok && <span className="text-sm text-green-600">Saved ✓</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
