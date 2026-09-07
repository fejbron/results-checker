"use server";

import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeResult } from "@/lib/grades";
import { studentLookupSchema } from "@/lib/validation";
import type { CourseResult } from "@/lib/types";

// A real bcrypt hash of a random string, compared against when no student
// matches so the unknown-index path costs the same as the wrong-PIN path.
const DUMMY_PIN_HASH =
  "$2b$10$YU6znOkNSio58.vnn/f/nu6YZyzMLseosfEPwQYoX3eYfz2e6zeoi";

export type LookupState = {
  error: string | null;
  studentName?: string;
  results?: CourseResult[];
};

// Verify a student's index number + PIN, then return their results across all
// enrolled courses. Runs entirely server-side with the service-role key; the
// student never gets a Supabase session and only their own data is returned.
export async function lookupResults(
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const parsed = studentLookupSchema.safeParse({
    index_number: formData.get("index_number"),
    pin: formData.get("pin"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const admin = createAdminClient();

  const { data: student } = await admin
    .from("students")
    .select("id, full_name, pin_hash")
    .eq("index_number", parsed.data.index_number)
    .maybeSingle<{ id: string; full_name: string; pin_hash: string }>();

  // Same generic message whether the index is unknown or the PIN is wrong.
  const invalid = { error: "Index number or PIN is incorrect." };

  // Always run a bcrypt comparison, even when the index number is unknown, so
  // the response time cannot be used to enumerate valid index numbers.
  const match = await bcrypt.compare(
    parsed.data.pin,
    student?.pin_hash ?? DUMMY_PIN_HASH,
  );
  if (!student || !match) return invalid;

  // Courses this student is enrolled in.
  const { data: enrollments } = await admin
    .from("enrollments")
    .select("courses(id, name, code, overall_score)")
    .eq("student_id", student.id)
    .returns<
      {
        courses: {
          id: string;
          name: string;
          code: string;
          overall_score: number | null;
        };
      }[]
    >();

  const courses = (enrollments ?? []).map((e) => e.courses).filter(Boolean);
  if (courses.length === 0) {
    return { error: null, studentName: student.full_name, results: [] };
  }

  const courseIds = courses.map((c) => c.id);

  const { data: columns } = await admin
    .from("score_columns")
    .select("id, course_id, label, max_score, display_order")
    .in("course_id", courseIds)
    .order("display_order", { ascending: true });

  const { data: scores } = await admin
    .from("scores")
    .select("column_id, value")
    .eq("student_id", student.id)
    .in(
      "column_id",
      (columns ?? []).map((c) => c.id),
    );

  const scoreByColumn = new Map<string, number>(
    (scores ?? []).map((s) => [s.column_id, s.value]),
  );

  const results: CourseResult[] = courses.map((course) => {
    const courseColumns = (columns ?? []).filter((c) => c.course_id === course.id);
    const cells = courseColumns.map((c) => ({
      label: c.label,
      maxScore: c.max_score,
      value: scoreByColumn.has(c.id) ? scoreByColumn.get(c.id)! : null,
    }));
    const { mark, outOf, percentage } = computeResult(cells, course.overall_score);
    return {
      courseId: course.id,
      courseName: course.name,
      courseCode: course.code,
      columns: cells,
      mark,
      outOf,
      percentage,
    };
  });

  return { error: null, studentName: student.full_name, results };
}
