import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { deleteCourse } from "./actions";
import CreateCourseForm from "./create-course-form";

export const metadata = { title: "Dashboard — Results Checker" };

type CourseRow = {
  id: string;
  name: string;
  code: string;
  enrollments: { count: number }[];
  score_columns: { count: number }[];
};

export default async function AdminDashboard() {
  const supabase = await createClient();
  const { data: courses } = await supabase
    .from("courses")
    .select(
      "id, name, code, enrollments(count), score_columns(count)",
    )
    .order("created_at", { ascending: false })
    .returns<CourseRow[]>();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Your courses</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a course, define its score columns, enroll students, and enter
          results.
        </p>
      </div>

      <CreateCourseForm />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(courses ?? []).map((course) => (
          <div key={course.id} className="card flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">
                {course.code}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                {course.name}
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {course.enrollments?.[0]?.count ?? 0} students ·{" "}
                {course.score_columns?.[0]?.count ?? 0} columns
              </p>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Link
                href={`/admin/courses/${course.id}`}
                className="btn-primary flex-1"
              >
                Manage
              </Link>
              <form action={deleteCourse}>
                <input type="hidden" name="courseId" value={course.id} />
                <button type="submit" className="btn-danger">
                  Delete
                </button>
              </form>
            </div>
          </div>
        ))}
        {(!courses || courses.length === 0) && (
          <p className="col-span-full rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            No courses yet. Create your first one above.
          </p>
        )}
      </div>
    </div>
  );
}
