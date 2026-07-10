"use client";

import { useActionState, useEffect, useRef } from "react";
import { addStudent, type ActionState } from "../../actions";

const initial: ActionState = { error: null };

export default function AddStudentForm({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(addStudent, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="courseId" value={courseId} />
      <div className="flex-1">
        <label className="label" htmlFor="index_number">
          Index number
        </label>
        <input id="index_number" name="index_number" className="input" placeholder="UEB0101220" required />
      </div>
      <div className="flex-1">
        <label className="label" htmlFor="full_name">
          Full name
        </label>
        <input id="full_name" name="full_name" className="input" placeholder="Ama Mensah" required />
      </div>
      <div className="sm:w-40">
        <label className="label" htmlFor="pin">
          PIN (optional)
        </label>
        <input id="pin" name="pin" className="input" placeholder="last 4 of index" />
      </div>
      <button type="submit" className="btn-primary" disabled={pending}>
        {pending ? "Adding…" : "Add student"}
      </button>
      {state.error && <p className="text-sm text-red-600 sm:self-center">{state.error}</p>}
    </form>
  );
}
