import Link from "next/link";
import { BookOpen, Users, ListChecks, ArrowUpRight, GraduationCap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { deleteCourse } from "./actions";
import CreateCourseForm from "./create-course-form";

export const metadata = { title: "Dashboard — Results Checker" };

type CourseRow = {
  id: string;
  name: string;
  code: string;
  created_at: string;
  enrollments: { count: number }[];
  score_columns: { count: number }[];
};

const CHIP_STYLES = [
  { bg: "bg-blue-50", fg: "text-blue-600" },
  { bg: "bg-teal-50", fg: "text-teal-600" },
  { bg: "bg-orange-50", fg: "text-orange-500" },
];

export default async function AdminDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courses } = await supabase
    .from("courses")
    .select("id, name, code, created_at, enrollments(count), score_columns(count)")
    .order("created_at", { ascending: false })
    .returns<CourseRow[]>();

  const list = courses ?? [];
  const totalStudents = list.reduce((s, c) => s + (c.enrollments?.[0]?.count ?? 0), 0);
  const totalColumns = list.reduce((s, c) => s + (c.score_columns?.[0]?.count ?? 0), 0);

  const name = (user?.email ?? "there").split("@")[0];
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();

  const stats = [
    { icon: BookOpen, label: "Courses", value: list.length },
    { icon: Users, label: "Students", value: totalStudents },
    { icon: ListChecks, label: "Assessments", value: totalColumns },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      {/* Main column */}
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Welcome back, {displayName}!
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Manage your courses, students and results.
            </p>
          </div>
        </header>

        {/* Stat chips */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {stats.map((s, i) => {
            const Icon = s.icon;
            const style = CHIP_STYLES[i % CHIP_STYLES.length];
            return (
              <div key={s.label} className="card flex items-center gap-3 p-4">
                <span className={`icon-chip ${style.bg} ${style.fg}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-medium text-slate-400">{s.label}</p>
                  <p className="text-xl font-bold text-slate-900">{s.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Courses */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Your courses</h2>
            <span className="text-sm text-slate-400">{list.length} total</span>
          </div>

          {list.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-12 text-center">
              <span className="icon-chip bg-blue-50 text-blue-600">
                <BookOpen className="h-5 w-5" />
              </span>
              <p className="text-sm text-slate-500">
                No courses yet. Create your first one on the right.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {list.map((course, i) => {
                const style = CHIP_STYLES[i % CHIP_STYLES.length];
                return (
                  <div key={course.id} className="card group flex flex-col gap-4">
                    <div className="flex items-start justify-between">
                      <span className={`icon-chip ${style.bg} ${style.fg}`}>
                        <BookOpen className="h-5 w-5" />
                      </span>
                      <form action={deleteCourse}>
                        <input type="hidden" name="courseId" value={course.id} />
                        <button
                          type="submit"
                          className="rounded-full px-3 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                        {course.code}
                      </p>
                      <h3 className="mt-0.5 text-base font-semibold text-slate-900">
                        {course.name}
                      </h3>
                      <p className="mt-1 text-sm text-slate-400">
                        {course.enrollments?.[0]?.count ?? 0} students ·{" "}
                        {course.score_columns?.[0]?.count ?? 0} assessments
                      </p>
                    </div>
                    <Link
                      href={`/admin/courses/${course.id}`}
                      className="mt-auto inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:gap-2"
                    >
                      Manage <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Right panel */}
      <div className="space-y-4">
        <div className="card flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-teal-400 text-2xl font-bold text-white">
            {initials}
          </div>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">{displayName}</h2>
          <p className="text-sm text-slate-400">Lecturer</p>
          <p className="mt-1 max-w-full truncate text-xs text-slate-400">{user?.email}</p>

          <div className="mt-4 grid w-full grid-cols-3 divide-x divide-slate-100 rounded-2xl bg-slate-50 py-3">
            <div>
              <p className="text-base font-bold text-slate-900">{list.length}</p>
              <p className="text-[11px] text-slate-400">Courses</p>
            </div>
            <div>
              <p className="text-base font-bold text-slate-900">{totalStudents}</p>
              <p className="text-[11px] text-slate-400">Students</p>
            </div>
            <div>
              <p className="text-base font-bold text-slate-900">{totalColumns}</p>
              <p className="text-[11px] text-slate-400">Scores</p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="mb-3 flex items-center gap-2">
            <span className="icon-chip h-9 w-9 bg-teal-50 text-teal-600">
              <GraduationCap className="h-5 w-5" />
            </span>
            <h2 className="text-base font-semibold text-slate-900">Create a course</h2>
          </div>
          <CreateCourseForm />
        </div>
      </div>
    </div>
  );
}
