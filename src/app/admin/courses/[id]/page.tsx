import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Target,
  Users,
  ClipboardList,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Course, ScoreColumn } from "@/lib/types";
import { deleteColumn, removeStudent } from "../../actions";
import AddColumnForm from "./add-column-form";
import AddStudentForm from "./add-student-form";
import ImportStudentsForm from "./import-students-form";
import OverallScoreForm from "./overall-score-form";
import ResetPinForm from "./reset-pin-form";
import ScoresGrid from "./scores-grid";

type EnrolledStudent = {
  id: string;
  index_number: string;
  full_name: string;
};

export default async function CoursePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: course } = await supabase
    .from("courses")
    .select("*")
    .eq("id", id)
    .maybeSingle<Course>();

  if (!course) notFound();

  const { data: columns } = await supabase
    .from("score_columns")
    .select("*")
    .eq("course_id", id)
    .order("display_order", { ascending: true })
    .returns<ScoreColumn[]>();

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("students(id, index_number, full_name)")
    .eq("course_id", id)
    .returns<{ students: EnrolledStudent }[]>();

  const students = (enrollments ?? [])
    .map((e) => e.students)
    .filter(Boolean)
    .sort((a, b) => a.index_number.localeCompare(b.index_number));

  const cols = columns ?? [];
  const columnIds = cols.map((c) => c.id);

  // Load existing scores into a { studentId: { columnId: value } } map.
  const scoreMap: Record<string, Record<string, number>> = {};
  if (columnIds.length) {
    const { data: scores } = await supabase
      .from("scores")
      .select("student_id, column_id, value")
      .in("column_id", columnIds);
    for (const s of scores ?? []) {
      (scoreMap[s.student_id] ??= {})[s.column_id] = s.value;
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
      <div className="card flex items-center gap-4">
        <span className="icon-chip h-14 w-14 bg-blue-50 text-blue-600">
          <BookOpen className="h-6 w-6" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
            {course.code}
          </p>
          <h1 className="text-2xl font-bold text-slate-900">{course.name}</h1>
        </div>
      </div>

      {/* Score columns */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3">
          <span className="icon-chip h-9 w-9 bg-blue-50 text-blue-600">
            <BookOpen className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Score columns</h2>
            <p className="text-sm text-slate-500">
              Add any assessment — assignment, presentation, project, exam — with
              its maximum score.
            </p>
          </div>
        </div>
        {cols.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {cols.map((col) => (
              <li
                key={col.id}
                className="flex items-center gap-2 rounded-full bg-slate-100 py-1.5 pl-4 pr-1.5 text-sm"
              >
                <span className="font-medium text-slate-700">{col.label}</span>
                <span className="text-slate-400">/{col.max_score}</span>
                <form action={deleteColumn}>
                  <input type="hidden" name="courseId" value={course.id} />
                  <input type="hidden" name="columnId" value={col.id} />
                  <button
                    type="submit"
                    className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600"
                    title={`Delete ${col.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No columns yet.</p>
        )}
        <AddColumnForm courseId={course.id} />
      </section>

      {/* Overall score */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3">
          <span className="icon-chip h-9 w-9 bg-teal-50 text-teal-600">
            <Target className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Overall score</h2>
            <p className="text-sm text-slate-500">
              Optionally scale the combined columns to a single mark — e.g. grade
              everything out of 40. Leave blank to total the raw column maximums
              {cols.length > 0 && (
                <>
                  {" "}
                  (currently {cols.reduce((s, c) => s + Number(c.max_score), 0)})
                </>
              )}
              .
            </p>
          </div>
        </div>
        <OverallScoreForm courseId={course.id} overallScore={course.overall_score} />
      </section>

      {/* Students */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3">
          <span className="icon-chip h-9 w-9 bg-orange-50 text-orange-500">
            <Users className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Students</h2>
            <p className="text-sm text-slate-500">
              Enroll students by index number. New students get a default PIN of
              the last 4 digits of their index number unless you set one.
            </p>
          </div>
        </div>
        <AddStudentForm courseId={course.id} />
        <ImportStudentsForm courseId={course.id} />
        {students.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4 font-medium">Index number</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">PIN</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100">
                    <td className="py-2 pr-4 font-mono">{s.index_number}</td>
                    <td className="py-2 pr-4">{s.full_name}</td>
                    <td className="py-2 pr-4">
                      <ResetPinForm courseId={course.id} studentId={s.id} />
                    </td>
                    <td className="py-2 text-right">
                      <form action={removeStudent}>
                        <input type="hidden" name="courseId" value={course.id} />
                        <input type="hidden" name="studentId" value={s.id} />
                        <button type="submit" className="text-sm text-red-600 hover:underline">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No students enrolled yet.</p>
        )}
      </section>

      {/* Scores grid */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3">
          <span className="icon-chip h-9 w-9 bg-blue-50 text-blue-600">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Enter results</h2>
            <p className="text-sm text-slate-500">
              Type scores and click Save. Totals update live as you type.
            </p>
          </div>
        </div>
        {cols.length === 0 || students.length === 0 ? (
          <p className="text-sm text-slate-400">
            Add at least one score column and one student to enter results.
          </p>
        ) : (
          <ScoresGrid
            courseId={course.id}
            columns={cols.map((c) => ({ id: c.id, label: c.label, maxScore: c.max_score }))}
            students={students}
            scoreMap={scoreMap}
            overallScore={course.overall_score}
          />
        )}
      </section>
    </div>
  );
}
