import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Course, ScoreColumn } from "@/lib/types";
import { deleteColumn, removeStudent } from "../../actions";
import AddColumnForm from "./add-column-form";
import AddStudentForm from "./add-student-form";
import ImportStudentsForm from "./import-students-form";
import ImportResultsForm from "./import-results-form";
import OverallScoreForm from "./overall-score-form";
import ResetPinForm from "./reset-pin-form";
import ScoresGrid from "./scores-grid";
import ExportResultsButton from "./export-results-button";

// Courses here run to several hundred students, which is far too many to render
// (or to load scores for) in one page.
const PAGE_SIZE = 50;

type EnrolledStudent = {
  id: string;
  index_number: string;
  full_name: string;
};

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
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

  // Selecting from `students` with an inner join lets Postgres do the ordering
  // and the paging; going the other way (enrollments -> students) can only sort
  // after the rows have already been fetched.
  const { count } = await supabase
    .from("students")
    .select("id, enrollments!inner(course_id)", { count: "exact", head: true })
    .eq("enrollments.course_id", id);

  const totalStudents = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));
  const requestedPage = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(requestedPage)
    ? Math.min(Math.max(requestedPage, 1), totalPages)
    : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const { data: pageStudents } = await supabase
    .from("students")
    .select("id, index_number, full_name, enrollments!inner(course_id)")
    .eq("enrollments.course_id", id)
    .order("index_number", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1)
    .returns<EnrolledStudent[]>();

  const students = (pageStudents ?? []).map((s) => ({
    id: s.id,
    index_number: s.index_number,
    full_name: s.full_name,
  }));

  const cols = columns ?? [];
  const columnIds = cols.map((c) => c.id);

  // Scores for the visible students only. Loading the whole course in one go
  // would silently truncate at PostgREST's row cap, and a blank cell in the
  // grid is treated as "clear this score" on save — i.e. real data loss.
  const scoreMap: Record<string, Record<string, number>> = {};
  if (columnIds.length && students.length) {
    const { data: scores } = await supabase
      .from("scores")
      .select("student_id, column_id, value")
      .in("column_id", columnIds)
      .in("student_id", students.map((s) => s.id));
    for (const s of scores ?? []) {
      (scoreMap[s.student_id] ??= {})[s.column_id] = s.value;
    }
  }

  const pager = (
    <Pager
      courseId={course.id}
      page={page}
      totalPages={totalPages}
      offset={offset}
      shown={students.length}
      total={totalStudents}
    />
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/admin"
        className="text-sm font-medium text-slate-500 hover:text-slate-700"
      >
        ← Back to dashboard
      </Link>
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {course.code}
        </p>
        <h1 className="text-2xl font-bold text-slate-900">{course.name}</h1>
      </div>

      {/* Score columns */}
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Score columns</h2>
          <p className="text-sm text-slate-500">
            Add any assessment — assignment, presentation, project, exam — with
            its maximum score.
          </p>
        </div>
        {cols.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {cols.map((col) => (
              <li
                key={col.id}
                className="flex items-center gap-2 rounded-md bg-slate-100 py-1.5 pl-4 pr-1.5 text-sm"
              >
                <span className="font-medium text-slate-700">{col.label}</span>
                <span className="text-slate-400">/{col.max_score}</span>
                <form action={deleteColumn}>
                  <input type="hidden" name="courseId" value={course.id} />
                  <input type="hidden" name="columnId" value={col.id} />
                  <button
                    type="submit"
                    className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-red-100 hover:text-red-600"
                    title={`Delete ${col.label}`}
                  >
                    ×
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
        <OverallScoreForm courseId={course.id} overallScore={course.overall_score} />
      </section>

      {/* Students */}
      <section className="card space-y-4">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Students</h2>
            <span className="text-sm text-slate-400">{totalStudents} enrolled</span>
          </div>
          <p className="text-sm text-slate-500">
            Enroll students by index number. New students get a default PIN of
            the last 4 digits of their index number unless you set one.
          </p>
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
        {pager}
      </section>

      {/* Scores grid */}
      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Enter results</h2>
          <p className="text-sm text-slate-500">
            Type scores and click Save. Totals update live as you type.
            {totalPages > 1 && (
              <> Saving applies to the {students.length} students shown on this page.</>
            )}
          </p>
        </div>
        {cols.length === 0 || students.length === 0 ? (
          <p className="text-sm text-slate-400">
            Add at least one score column and one student to enter results.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <ImportResultsForm courseId={course.id} />
              <ExportResultsButton courseId={course.id} />
            </div>
            <ScoresGrid
              courseId={course.id}
              columns={cols.map((c) => ({ id: c.id, label: c.label, maxScore: c.max_score }))}
              students={students}
              scoreMap={scoreMap}
              overallScore={course.overall_score}
            />
            {pager}
          </>
        )}
      </section>
    </div>
  );
}

// Page links for the student list and the scores grid. Both show the same
// slice, so one `?page=` parameter drives them together.
function Pager({
  courseId,
  page,
  totalPages,
  offset,
  shown,
  total,
}: {
  courseId: string;
  page: number;
  totalPages: number;
  offset: number;
  shown: number;
  total: number;
}) {
  if (totalPages <= 1) return null;

  const href = (p: number) => `/admin/courses/${courseId}?page=${p}`;
  const step = "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
      <span className="text-sm text-slate-500">
        Showing {offset + 1}–{offset + shown} of {total}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={`${step} text-slate-700 hover:bg-slate-50`}>
            Previous
          </Link>
        ) : (
          <span className={`${step} text-slate-300`}>Previous</span>
        )}
        <span className="text-sm text-slate-500">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={href(page + 1)} className={`${step} text-slate-700 hover:bg-slate-50`}>
            Next
          </Link>
        ) : (
          <span className={`${step} text-slate-300`}>Next</span>
        )}
      </div>
    </div>
  );
}
