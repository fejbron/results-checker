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
import { csvDocument } from "@/lib/csv";
import { computeResult } from "@/lib/grades";

export type ActionState = { error: string | null; ok?: boolean };

const ok: ActionState = { error: null, ok: true };
const fail = (error: string): ActionState => ({ error });

// Postgres unique-violation. Test the SQLSTATE, not the message text — the
// wording is version- and locale-dependent.
function isDuplicateKey(error: { code?: string } | null) {
  return error?.code === "23505";
}

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

// Confirm a student is actually enrolled in the given course. The caller must
// already have checked course ownership. Server Actions are reachable by direct
// POST, so ids arriving in FormData are untrusted.
async function assertStudentEnrolled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
  studentId: string,
) {
  const { data } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!data) throw new Error("That student is not enrolled in this course.");
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
    if (!Number.isFinite(n) || n <= 0) {
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
  if (enrollErr && !isDuplicateKey(enrollErr)) {
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

// Headers that `exportResults` writes for readability rather than as data.
const EXPORT_ONLY_HEADERS = new Set(["name", "full name", "total", "out of", "percentage"]);

// Import a wide "gradebook" CSV: first column is the index number, each
// remaining header is matched (case-insensitive) to an existing score column
// by label. Fills blank cells only — never overwrites or clears a saved score.
export async function importResults(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const courseId = String(formData.get("courseId"));

  // Accept either a pasted textarea or an uploaded file.
  const file = formData.get("file");
  let text = String(formData.get("csv") ?? "");
  if (file instanceof File && file.size > 0) {
    text = await file.text();
  }
  text = text.trim();
  if (!text) return fail("Paste CSV rows or choose a file to import.");

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return fail("Need a header row plus at least one student row.");
  }

  const { supabase } = await assertCourseOwner(courseId);
  const admin = createAdminClient();

  // Existing columns, keyed by lowercased label.
  const { data: columns } = await supabase
    .from("score_columns")
    .select("id, label, max_score")
    .eq("course_id", courseId);
  const columnByLabel = new Map(
    (columns ?? []).map((c) => [c.label.trim().toLowerCase(), c]),
  );

  // Map header cells → column ids. Find the index column, collect unmatched.
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  let indexCol = header.findIndex((h) => /index/i.test(h));
  if (indexCol === -1) indexCol = 0;

  const mapped: { pos: number; column: { id: string; label: string; max_score: number } }[] = [];
  const unmatchedHeaders: string[] = [];
  header.forEach((h, pos) => {
    if (pos === indexCol || h === "") return;
    const col = columnByLabel.get(h.toLowerCase());
    if (col) {
      mapped.push({ pos, column: col });
      return;
    }
    // Columns `exportResults` adds for humans. Skipped quietly so an exported
    // file round-trips without noise — but only when no real score column
    // carries that label, which is why this runs after the lookup above.
    if (EXPORT_ONLY_HEADERS.has(h.toLowerCase())) return;
    unmatchedHeaders.push(h);
  });

  if (mapped.length === 0) {
    return fail(
      "No headers matched this course's score columns. Add the columns first, " +
        "then match the CSV headers to their labels.",
    );
  }

  // Preload existing scores so we can honour fill-blanks-only cheaply.
  const columnIds = mapped.map((m) => m.column.id);
  const filled = new Set<string>(); // `${studentId}__${columnId}`
  {
    const { data: existing } = await supabase
      .from("scores")
      .select("student_id, column_id")
      .in("column_id", columnIds);
    for (const s of existing ?? []) filled.add(`${s.student_id}__${s.column_id}`);
  }

  const errors: string[] = [];

  // Parse every row up front so students can be resolved and enrolled in bulk.
  // Doing it per row meant two sequential round trips per student, which for a
  // real class is hundreds of requests and will blow the serverless time limit.
  const rows: { indexNumber: string; cells: string[] }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const indexNumber = (cells[indexCol] ?? "").trim();
    if (!indexNumber) continue;
    rows.push({ indexNumber, cells });
  }

  // Resolve index numbers → student ids, chunked to keep the request URL sane.
  const studentIdByIndex = new Map<string, string>();
  const uniqueIndexes = [...new Set(rows.map((r) => r.indexNumber))];
  for (let i = 0; i < uniqueIndexes.length; i += 200) {
    const { data, error } = await admin
      .from("students")
      .select("id, index_number")
      .in("index_number", uniqueIndexes.slice(i, i + 200));
    if (error) return fail(error.message);
    for (const st of data ?? []) studentIdByIndex.set(st.index_number, st.id);
  }

  // Enroll anyone named in the file who is not already on the course.
  const { data: alreadyEnrolled } = await supabase
    .from("enrollments")
    .select("student_id")
    .eq("course_id", courseId);
  const enrolled = new Set((alreadyEnrolled ?? []).map((e) => e.student_id));

  const toEnroll = uniqueIndexes
    .map((idx) => studentIdByIndex.get(idx))
    .filter((id): id is string => !!id && !enrolled.has(id));

  let enrolledNew = 0;
  if (toEnroll.length) {
    const { error } = await supabase.from("enrollments").upsert(
      toEnroll.map((student_id) => ({ course_id: courseId, student_id })),
      { onConflict: "course_id,student_id", ignoreDuplicates: true },
    );
    if (error) return fail(error.message);
    enrolledNew = toEnroll.length;
  }

  const toInsert: { column_id: string; student_id: string; value: number }[] = [];
  const studentsScored = new Set<string>();

  for (const { indexNumber, cells } of rows) {
    const studentId = studentIdByIndex.get(indexNumber);
    if (!studentId) {
      errors.push(`${indexNumber}: not found`);
      continue;
    }

    for (const m of mapped) {
      const key = `${studentId}__${m.column.id}`;
      const raw = (cells[m.pos] ?? "").trim();
      if (raw === "") continue; // blank in file → skip
      if (filled.has(key)) continue; // already has a value → keep
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > Number(m.column.max_score)) {
        errors.push(`${indexNumber}/${m.column.label}: invalid`);
        continue;
      }
      toInsert.push({ column_id: m.column.id, student_id: studentId, value });
      filled.add(key); // guard against duplicate rows in the same file
      studentsScored.add(studentId);
    }
  }

  if (toInsert.length) {
    // Conflict-tolerant: a score that already exists for this (column, student)
    // is left untouched (fill-blanks-only) rather than aborting the batch. The
    // in-memory `filled` set already skips known-existing scores; this also
    // covers rows the preload could not see (PostgREST caps reads at 1000).
    const { error } = await supabase
      .from("scores")
      .upsert(toInsert, { onConflict: "column_id,student_id", ignoreDuplicates: true });
    if (error) return fail(error.message);
  }

  revalidatePath(`/admin/courses/${courseId}`);

  const summary =
    `Imported ${toInsert.length} score${toInsert.length === 1 ? "" : "s"} for ` +
    `${studentsScored.size} student${studentsScored.size === 1 ? "" : "s"}` +
    (enrolledNew ? ` (${enrolledNew} newly enrolled)` : "");

  const notes: string[] = [];
  if (unmatchedHeaders.length) {
    notes.push(`unmatched header${unmatchedHeaders.length === 1 ? "" : "s"}: ${unmatchedHeaders.join(", ")}`);
  }
  if (errors.length) {
    notes.push(
      `${errors.length} skipped: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? "…" : ""}`,
    );
  }

  if (notes.length) return { error: `${summary}. ${notes.join(". ")}` };
  return { error: null, ok: true };
}

export async function removeStudent(formData: FormData): Promise<void> {
  const courseId = String(formData.get("courseId"));
  const studentId = String(formData.get("studentId"));
  const { supabase } = await assertCourseOwner(courseId);

  // Drop this student's scores for the course's columns first. `scores` hangs
  // off `score_columns`/`students`, not `enrollments`, so deleting only the
  // enrollment would leave orphaned scores that resurface on re-enrollment.
  const { data: courseColumns } = await supabase
    .from("score_columns")
    .select("id")
    .eq("course_id", courseId);
  const courseColumnIds = (courseColumns ?? []).map((c) => c.id);
  if (courseColumnIds.length) {
    await supabase
      .from("scores")
      .delete()
      .eq("student_id", studentId)
      .in("column_id", courseColumnIds);
  }

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

  // Verify the lecturer owns the course AND that this student is enrolled in
  // it. Ownership alone is not enough: the update below runs with the
  // service-role key, so without the enrollment check any lecturer could reset
  // any student's PIN institution-wide by POSTing an arbitrary studentId.
  const { supabase } = await assertCourseOwner(courseId);
  try {
    await assertStudentEnrolled(supabase, courseId, studentId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Student is not enrolled.");
  }

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

  // The ids in the form are untrusted (Server Actions accept direct POSTs), so
  // every cell is checked against this course's own columns and enrolled
  // students before it is written.
  const { data: courseColumns } = await supabase
    .from("score_columns")
    .select("id, label, max_score")
    .eq("course_id", courseId);
  const columnById = new Map((courseColumns ?? []).map((c) => [c.id, c]));

  const { data: courseEnrollments } = await supabase
    .from("enrollments")
    .select("student_id")
    .eq("course_id", courseId);
  const enrolled = new Set((courseEnrollments ?? []).map((e) => e.student_id));

  // Field names look like: score__<studentId>__<columnId>
  const toUpsert: { column_id: string; student_id: string; value: number }[] = [];
  const toDelete: { column_id: string; student_id: string }[] = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("score__")) continue;
    const [, studentId, columnId] = key.split("__");

    const column = columnById.get(columnId);
    if (!column || !enrolled.has(studentId)) {
      return fail("This course's columns or students changed. Reload the page.");
    }

    const text = String(raw).trim();
    if (text === "") {
      toDelete.push({ column_id: columnId, student_id: studentId });
      continue;
    }
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) {
      return fail(`Invalid score "${text}".`);
    }
    if (value > Number(column.max_score)) {
      return fail(
        `${column.label}: ${value} is above the maximum of ${column.max_score}.`,
      );
    }
    toUpsert.push({ column_id: columnId, student_id: studentId, value });
  }

  if (toUpsert.length) {
    const { error } = await supabase
      .from("scores")
      .upsert(toUpsert, { onConflict: "column_id,student_id" });
    if (error) return fail(error.message);
  }

  // Clear any cleared cells — one request per column rather than per cell, and
  // report a failure instead of silently leaving the old value in place.
  const clearedByColumn = new Map<string, string[]>();
  for (const d of toDelete) {
    const ids = clearedByColumn.get(d.column_id) ?? [];
    ids.push(d.student_id);
    clearedByColumn.set(d.column_id, ids);
  }
  for (const [columnId, studentIds] of clearedByColumn) {
    const { error } = await supabase
      .from("scores")
      .delete()
      .eq("column_id", columnId)
      .in("student_id", studentIds);
    if (error) return fail(error.message);
  }

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

// PostgREST caps a single response (1000 rows by default), so anything that has
// to cover a whole course reads in pages rather than one unbounded select.
const READ_PAGE = 1000;

type EnrolledRow = { id: string; index_number: string; full_name: string };

async function readAllEnrolled(
  supabase: Awaited<ReturnType<typeof createClient>>,
  courseId: string,
): Promise<EnrolledRow[]> {
  const out: EnrolledRow[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from("students")
      .select("id, index_number, full_name, enrollments!inner(course_id)")
      .eq("enrollments.course_id", courseId)
      .order("index_number", { ascending: true })
      .range(from, from + READ_PAGE - 1)
      .returns<EnrolledRow[]>();
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows.map((r) => ({
      id: r.id,
      index_number: r.index_number,
      full_name: r.full_name,
    })));
    if (rows.length < READ_PAGE) return out;
  }
}

async function readAllScores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  columnIds: string[],
): Promise<Map<string, number>> {
  const byKey = new Map<string, number>();
  if (columnIds.length === 0) return byKey;
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await supabase
      .from("scores")
      .select("student_id, column_id, value")
      .in("column_id", columnIds)
      .order("student_id", { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) byKey.set(`${r.student_id}__${r.column_id}`, r.value);
    if (rows.length < READ_PAGE) return byKey;
  }
}

// Build a CSV of every entered result for a course. The leading columns match
// what `importResults` expects (index number first, then one column per score
// column, matched by label) so an exported file can be edited and re-imported;
// the trailing computed columns are ignored on the way back in.
export async function exportResults(
  courseId: string,
): Promise<{ csv?: string; filename?: string; error?: string }> {
  let supabase;
  try {
    ({ supabase } = await assertCourseOwner(courseId));
  } catch {
    return { error: "Course not found." };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("code, name, overall_score")
    .eq("id", courseId)
    .maybeSingle<{ code: string; name: string; overall_score: number | null }>();
  if (!course) return { error: "Course not found." };

  const { data: columns, error: colErr } = await supabase
    .from("score_columns")
    .select("id, label, max_score")
    .eq("course_id", courseId)
    .order("display_order", { ascending: true });
  if (colErr) return { error: colErr.message };
  const cols = columns ?? [];

  let students: EnrolledRow[];
  let scores: Map<string, number>;
  try {
    students = await readAllEnrolled(supabase, courseId);
    scores = await readAllScores(supabase, cols.map((c) => c.id));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read results." };
  }

  if (students.length === 0) return { error: "No students are enrolled yet." };

  const header = [
    "index number",
    "name",
    ...cols.map((c) => c.label),
    "total",
    "out of",
    "percentage",
  ];

  const rows = students.map((st) => {
    const cells = cols.map((c) => ({
      maxScore: Number(c.max_score),
      value: scores.has(`${st.id}__${c.id}`)
        ? Number(scores.get(`${st.id}__${c.id}`))
        : null,
    }));
    const { mark, outOf, percentage } = computeResult(cells, course.overall_score);
    return [
      st.index_number,
      st.full_name,
      // Blank, not 0, for an ungraded cell — 0 is a real mark.
      ...cells.map((c) => (c.value === null ? "" : c.value)),
      mark,
      outOf,
      percentage,
    ];
  });

  const slug =
    course.code.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "course";

  return {
    csv: csvDocument([header, ...rows]),
    filename: `${slug}-results.csv`,
  };
}

// A blank gradebook for this course: the header `importResults` expects plus
// one row per enrolled student with empty score cells. Built server-side so it
// covers every student, not just the page the lecturer happens to be viewing.
export async function buildResultsTemplate(
  courseId: string,
): Promise<{ csv?: string; filename?: string; error?: string }> {
  let supabase;
  try {
    ({ supabase } = await assertCourseOwner(courseId));
  } catch {
    return { error: "Course not found." };
  }

  const { data: course } = await supabase
    .from("courses")
    .select("code")
    .eq("id", courseId)
    .maybeSingle<{ code: string }>();
  if (!course) return { error: "Course not found." };

  const { data: columns, error: colErr } = await supabase
    .from("score_columns")
    .select("label")
    .eq("course_id", courseId)
    .order("display_order", { ascending: true });
  if (colErr) return { error: colErr.message };
  const labels = (columns ?? []).map((c) => c.label);
  if (labels.length === 0) return { error: "Add at least one score column first." };

  let students: EnrolledRow[];
  try {
    students = await readAllEnrolled(supabase, courseId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read students." };
  }
  if (students.length === 0) return { error: "No students are enrolled yet." };

  const header = ["index number", "name", ...labels];
  const rows = students.map((st) => [
    st.index_number,
    st.full_name,
    ...labels.map(() => ""),
  ]);

  const slug =
    course.code.trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "course";

  return {
    csv: csvDocument([header, ...rows]),
    filename: `${slug}-results-template.csv`,
  };
}
