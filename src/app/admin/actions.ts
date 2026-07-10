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

export async function updateOverallScore(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));
  const raw = String(formData.get("overall_score") ?? "").trim();

  // Empty clears the override (fall back to the sum of column maximums).
  let overall_score: number | null = null;
  if (raw !== "") {
    const n = Number(raw);
    if (Number.isNaN(n) || n <= 0) {
      return fail("Overall score must be a number greater than 0 (or blank).");
    }
    overall_score = n;
  }

  const { supabase } = await assertCourseOwner(courseId);
  const { error } = await supabase
    .from("courses")
    .update({ overall_score })
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

  try {
    await enrollStudent(admin, supabase, courseId, parsed.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not add student.");
  }

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}

// Find or create a global student by index number, then enroll them in the
// course. Idempotent — re-enrolling an existing student is a no-op. Throws on
// unexpected database errors. Returns whether the student was newly created.
async function enrollStudent(
  admin: ReturnType<typeof createAdminClient>,
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
  input: { index_number: string; full_name: string; pin?: string },
): Promise<{ created: boolean }> {
  const { data: existing } = await admin
    .from("students")
    .select("id")
    .eq("index_number", input.index_number)
    .maybeSingle();

  let studentId = existing?.id;
  let created = false;

  if (!studentId) {
    const pin = input.pin ?? defaultPin(input.index_number);
    const pin_hash = await bcrypt.hash(pin, 10);
    const { data: row, error: createErr } = await admin
      .from("students")
      .insert({
        index_number: input.index_number,
        full_name: input.full_name,
        pin_hash,
      })
      .select("id")
      .single();
    if (createErr || !row) throw new Error(createErr?.message ?? "Could not create student.");
    studentId = row.id;
    created = true;
  }

  const { error: enrollErr } = await supabase
    .from("enrollments")
    .insert({ course_id: courseId, student_id: studentId });
  if (enrollErr && !enrollErr.message.toLowerCase().includes("duplicate")) {
    throw new Error(enrollErr.message);
  }

  return { created };
}

// Parse simple CSV text into student rows. Accepts an optional header row and
// columns in the order: index number, full name, PIN (PIN optional).
function parseStudentCsv(text: string) {
  const rows: { index_number: string; full_name: string; pin?: string }[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    // Skip a header row if the first line looks like column titles.
    if (i === 0 && /index|name/i.test(cells[0] ?? "")) continue;
    const [index_number, full_name, pin] = cells;
    if (!index_number || !full_name) continue;
    rows.push({
      index_number: index_number.trim(),
      full_name: full_name.trim(),
      pin: pin?.trim() || undefined,
    });
  }
  return rows;
}

// Minimal CSV line splitter that understands double-quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function importStudents(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));

  // Accept either a pasted textarea or an uploaded .csv file.
  const file = formData.get("file");
  let text = String(formData.get("csv") ?? "");
  if (file instanceof File && file.size > 0) {
    text = await file.text();
  }
  text = text.trim();
  if (!text) return fail("Paste CSV rows or choose a file to import.");

  const rows = parseStudentCsv(text);
  if (rows.length === 0) {
    return fail("No valid rows found. Use: index number, full name, PIN (optional).");
  }

  const { supabase } = await assertCourseOwner(courseId);
  const admin = createAdminClient();

  let created = 0;
  let enrolled = 0;
  const errors: string[] = [];

  for (const raw of rows) {
    const parsed = studentSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`${raw.index_number || "(blank)"}: ${parsed.error.issues[0].message}`);
      continue;
    }
    try {
      const res = await enrollStudent(admin, supabase, courseId, parsed.data);
      enrolled++;
      if (res.created) created++;
    } catch (e) {
      errors.push(`${raw.index_number}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  revalidatePath(`/admin/courses/${courseId}`);

  const summary = `Imported ${enrolled} student${enrolled === 1 ? "" : "s"} (${created} new)`;
  if (errors.length) {
    return {
      error: `${summary}. ${errors.length} row${errors.length === 1 ? "" : "s"} skipped: ${errors
        .slice(0, 5)
        .join("; ")}${errors.length > 5 ? "…" : ""}`,
    };
  }
  return { error: null, ok: true };
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
