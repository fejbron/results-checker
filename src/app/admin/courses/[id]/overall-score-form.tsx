"use client";

import { useActionState } from "react";
import { updateOverallScore, type ActionState } from "../../actions";

const initial: ActionState = { error: null };

export default function OverallScoreForm({
  courseId,
  overallScore,
}: {
  courseId: string;
  overallScore: number | null;
}) {
  const [state, action, pending] = useActionState(updateOverallScore, initial);

  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="courseId" value={courseId} />
      <div className="sm:w-48">
        <label className="label" htmlFor="overall_score">
          Overall score
        </label>
        <input
          id="overall_score"
          name="overall_score"
          type="number"
          min="1"
          step="any"
          defaultValue={overallScore ?? ""}
          className="input"
          placeholder="e.g. 40 (blank = raw)"
        />
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state.ok && <span className="text-sm text-green-600 sm:self-center">Saved ✓</span>}
      {state.error && <span className="text-sm text-red-600 sm:self-center">{state.error}</span>}
    </form>
  );
}
