"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  courseSchema,
  scoreColumnSchema,
  studentSchema,
  pinResetSchema,
} from "@/lib/validation";
import { DEFAULT_GRADE_SCALE, type GradeBand } from "@/lib/types";

export type ActionState = { error: string | null; ok?: boolean };

const ok: ActionState = { error: null, ok: true };
const fail = (error: string): ActionState => ({ error });

// Ensure a lecturer is signed in; return their id or throw.
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, userId: user.id };
}

// Confirm the signed-in lecturer owns the given course.
async function assertCourseOwner(courseId: string) {
  const { supabase, userId } = await requireUser();
  const { data, error } = await supabase
    .from("courses")
    .select("id, owner_id")
    .eq("id", courseId)
    .single();
  if (error || !data || data.owner_id !== userId) {
    throw new Error("Course not found");
  }
  return { supabase, userId };
}

// Default PIN = last 4 characters of the index number (min length guarded).
function defaultPin(indexNumber: string) {
  const trimmed = indexNumber.replace(/\s+/g, "");
  return trimmed.length >= 4 ? trimmed.slice(-4) : trimmed.padStart(4, "0");
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------
export async function createCourse(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = courseSchema.safeParse({
    name: formData.get("name"),
    code: formData.get("code"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("courses").insert({
    owner_id: userId,
    name: parsed.data.name,
    code: parsed.data.code,
    grade_scale: DEFAULT_GRADE_SCALE,
  });
  if (error) return fail(error.message);

  revalidatePath("/admin");
  return ok;
}

export async function deleteCourse(formData: FormData): Promise<void> {
  const courseId = String(formData.get("courseId"));
  const { supabase } = await assertCourseOwner(courseId);
  await supabase.from("courses").delete().eq("id", courseId);
  revalidatePath("/admin");
}

export async function updateGradeScale(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));
  const raw = String(formData.get("grade_scale") ?? "");

  let scale: GradeBand[];
  try {
    scale = JSON.parse(raw);
    if (!Array.isArray(scale) || scale.length === 0) throw new Error();
    scale = scale.map((b) => ({ min: Number(b.min), letter: String(b.letter) }));
    if (scale.some((b) => Number.isNaN(b.min) || !b.letter)) throw new Error();
  } catch {
    return fail("Grade scale must be valid JSON like [{\"min\":80,\"letter\":\"A\"}].");
  }

  const { supabase } = await assertCourseOwner(courseId);
  const { error } = await supabase
    .from("courses")
    .update({ grade_scale: scale })
    .eq("id", courseId);
  if (error) return fail(error.message);

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}

// ---------------------------------------------------------------------------
// Score columns
// ---------------------------------------------------------------------------
export async function addColumn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));
  const parsed = scoreColumnSchema.safeParse({
    label: formData.get("label"),
    max_score: formData.get("max_score"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { supabase } = await assertCourseOwner(courseId);

  // Place the new column at the end.
  const { count } = await supabase
    .from("score_columns")
    .select("*", { count: "exact", head: true })
    .eq("course_id", courseId);

  const { error } = await supabase.from("score_columns").insert({
    course_id: courseId,
    label: parsed.data.label,
    max_score: parsed.data.max_score,
    display_order: count ?? 0,
  });
  if (error) return fail(error.message);

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}

export async function deleteColumn(formData: FormData): Promise<void> {
  const courseId = String(formData.get("courseId"));
  const columnId = String(formData.get("columnId"));
  const { supabase } = await assertCourseOwner(courseId);
  await supabase.from("score_columns").delete().eq("id", columnId);
  revalidatePath(`/admin/courses/${courseId}`);
}

// ---------------------------------------------------------------------------
// Students & enrollment
// ---------------------------------------------------------------------------
export async function addStudent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));
  const parsed = studentSchema.safeParse({
    index_number: formData.get("index_number"),
    full_name: formData.get("full_name"),
    pin: formData.get("pin") || undefined,
  });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const { supabase } = await assertCourseOwner(courseId);
  // Students are global — use the service-role client so we can look one up
  // (and reuse it) even if they belong to another lecturer's course.
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("students")
    .select("id")
    .eq("index_number", parsed.data.index_number)
    .maybeSingle();

  let studentId = existing?.id;

  if (!studentId) {
    const pin = parsed.data.pin ?? defaultPin(parsed.data.index_number);
    const pin_hash = await bcrypt.hash(pin, 10);
    const { data: created, error: createErr } = await admin
      .from("students")
      .insert({
        index_number: parsed.data.index_number,
        full_name: parsed.data.full_name,
        pin_hash,
      })
      .select("id")
      .single();
    if (createErr || !created) return fail(createErr?.message ?? "Could not create student.");
    studentId = created.id;
  }

  // Enroll (idempotent thanks to the unique constraint).
  const { error: enrollErr } = await supabase
    .from("enrollments")
    .insert({ course_id: courseId, student_id: studentId });
  if (enrollErr && !enrollErr.message.includes("duplicate")) {
    return fail(enrollErr.message);
  }

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}

export async function removeStudent(formData: FormData): Promise<void> {
  const courseId = String(formData.get("courseId"));
  const studentId = String(formData.get("studentId"));
  const { supabase } = await assertCourseOwner(courseId);
  // Removing the enrollment (and any scores for this course's columns).
  await supabase
    .from("enrollments")
    .delete()
    .eq("course_id", courseId)
    .eq("student_id", studentId);
  revalidatePath(`/admin/courses/${courseId}`);
}

export async function resetPin(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));
  const studentId = String(formData.get("studentId"));
  const parsed = pinResetSchema.safeParse({ pin: formData.get("pin") });
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  // Verify the lecturer owns a course this student is enrolled in.
  await assertCourseOwner(courseId);
  const admin = createAdminClient();
  const pin_hash = await bcrypt.hash(parsed.data.pin, 10);
  const { error } = await admin
    .from("students")
    .update({ pin_hash })
    .eq("id", studentId);
  if (error) return fail(error.message);

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}

// ---------------------------------------------------------------------------
// Scores (bulk save from the grid)
// ---------------------------------------------------------------------------
export async function saveScores(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));
  const { supabase } = await assertCourseOwner(courseId);

  // Field names look like: score__<studentId>__<columnId>
  const toUpsert: { column_id: string; student_id: string; value: number }[] = [];
  const toDelete: { column_id: string; student_id: string }[] = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("score__")) continue;
    const [, studentId, columnId] = key.split("__");
    const text = String(raw).trim();
    if (text === "") {
      toDelete.push({ column_id: columnId, student_id: studentId });
      continue;
    }
    const value = Number(text);
    if (Number.isNaN(value) || value < 0) {
      return fail(`Invalid score "${text}".`);
    }
    toUpsert.push({ column_id: columnId, student_id: studentId, value });
  }

  if (toUpsert.length) {
    const { error } = await supabase
      .from("scores")
      .upsert(toUpsert, { onConflict: "column_id,student_id" });
    if (error) return fail(error.message);
  }

  // Clear any cleared cells.
  for (const d of toDelete) {
    await supabase
      .from("scores")
      .delete()
      .eq("column_id", d.column_id)
      .eq("student_id", d.student_id);
  }

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}
