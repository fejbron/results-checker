"use client";

import { useActionState } from "react";
import { updateGradeScale, type ActionState } from "../../actions";
import type { GradeBand } from "@/lib/types";

const initial: ActionState = { error: null };

export default function GradeScaleEditor({
  courseId,
  scale,
}: {
  courseId: string;
  scale: GradeBand[];
}) {
  const [state, action, pending] = useActionState(updateGradeScale, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="courseId" value={courseId} />
      <label className="label" htmlFor="grade_scale">
        Bands (JSON) — a letter is used when the percentage is at least{" "}
        <code>min</code>.
      </label>
      <textarea
        id="grade_scale"
        name="grade_scale"
        rows={7}
        className="input font-mono text-xs"
        defaultValue={JSON.stringify(scale, null, 2)}
      />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save grade scale"}
        </button>
        {state.ok && <span className="text-sm text-green-600">Saved ✓</span>}
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
