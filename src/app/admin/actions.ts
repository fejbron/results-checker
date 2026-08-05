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

export type ActionState = { error: string | null; ok?: boolean; message?: string };

// Rows per database round trip when importing. Keeps request bodies (and the
// `in (...)` filters PostgREST builds from them) to a sane size.
const BATCH_SIZE = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

  // Place the new column at the end. Counting rows would collide with an
  // existing order after a delete (3 columns, drop the middle → count 2, which
  // the last column already uses), so take the highest order and add one.
  const { data: last } = await supabase
    .from("score_columns")
    .select("display_order")
    .eq("course_id", courseId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();

  const { error } = await supabase.from("score_columns").insert({
    course_id: courseId,
    label: parsed.data.label,
    max_score: parsed.data.max_score,
    display_order: (last?.display_order ?? -1) + 1,
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

  // Validate every row up front, and collapse duplicate index numbers within
  // the file (last one wins) so we never insert the same student twice.
  const wanted = new Map<string, { index_number: string; full_name: string; pin?: string }>();
  const errors: string[] = [];
  for (const raw of rows) {
    const parsed = studentSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(`${raw.index_number || "(blank)"}: ${parsed.error.issues[0].message}`);
      continue;
    }
    wanted.set(parsed.data.index_number, parsed.data);
  }
  if (wanted.size === 0) {
    return fail(
      `No valid rows found. ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}`,
    );
  }

  // The whole import runs as a handful of batched queries rather than four
  // round trips per student — that is what made large files take minutes.
  const idByIndex = new Map<string, string>();
  for (const batch of chunk([...wanted.keys()], BATCH_SIZE)) {
    const { data, error } = await admin
      .from("students")
      .select("id, index_number")
      .in("index_number", batch);
    if (error) return fail(error.message);
    for (const s of data ?? []) idByIndex.set(s.index_number, s.id);
  }

  // Only students who don't exist yet need a (deliberately expensive) PIN hash.
  const toCreate = [...wanted.values()].filter((s) => !idByIndex.has(s.index_number));
  const newRows = await Promise.all(
    toCreate.map(async (s) => ({
      index_number: s.index_number,
      full_name: s.full_name,
      pin_hash: await bcrypt.hash(s.pin ?? defaultPin(s.index_number), 10),
    })),
  );

  let created = 0;
  for (const batch of chunk(newRows, BATCH_SIZE)) {
    // ignoreDuplicates keeps an existing student's PIN intact if someone else
    // created them between the lookup above and this insert.
    const { data, error } = await admin
      .from("students")
      .upsert(batch, { onConflict: "index_number", ignoreDuplicates: true })
      .select("id, index_number");
    if (error) return fail(error.message);
    for (const s of data ?? []) idByIndex.set(s.index_number, s.id);
    created += data?.length ?? 0;
  }

  // Anything still missing an id lost that race — fetch the winner's row.
  const missing = [...wanted.keys()].filter((ix) => !idByIndex.has(ix));
  for (const batch of chunk(missing, BATCH_SIZE)) {
    const { data } = await admin
      .from("students")
      .select("id, index_number")
      .in("index_number", batch);
    for (const s of data ?? []) idByIndex.set(s.index_number, s.id);
  }

  const enrollRows = [...wanted.keys()]
    .map((ix) => ({ course_id: courseId, student_id: idByIndex.get(ix) }))
    .filter((r): r is { course_id: string; student_id: string } => Boolean(r.student_id));

  for (const batch of chunk(enrollRows, BATCH_SIZE)) {
    const { error } = await supabase
      .from("enrollments")
      .upsert(batch, { onConflict: "course_id,student_id", ignoreDuplicates: true });
    if (error) return fail(error.message);
  }

  revalidatePath(`/admin/courses/${courseId}`);

  const enrolled = enrollRows.length;
  const summary = `Imported ${enrolled} student${enrolled === 1 ? "" : "s"} (${created} new)`;

  // A partial import is still a success: report it as one so the page refreshes
  // and the rows that *did* import show up. The skipped rows ride along as a
  // warning rather than turning the whole run into a failure.
  if (errors.length) {
    return {
      error: `${errors.length} row${errors.length === 1 ? "" : "s"} skipped: ${errors
        .slice(0, 5)
        .join("; ")}${errors.length > 5 ? "…" : ""}`,
      ok: true,
      message: summary,
    };
  }
  return { error: null, ok: true, message: summary };
}

export async function removeStudent(formData: FormData): Promise<void> {
  const courseId = String(formData.get("courseId"));
  const studentId = String(formData.get("studentId"));
  const { supabase } = await assertCourseOwner(courseId);
  // Drops the enrollment only. Any scores already entered for this course are
  // kept, so re-enrolling the same student restores their marks.
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

  // Verify the lecturer owns the course *and* that the student is enrolled in
  // it. Without the enrollment check the update below (service-role, so RLS
  // does not apply) would let any lecturer reset any student's PIN by id.
  const { supabase } = await assertCourseOwner(courseId);
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("id")
    .eq("course_id", courseId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (!enrollment) return fail("That student is not enrolled in this course.");

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

  // The grid posts one field per student × column, so a full class is easily a
  // thousand fields. Load this course's columns once — it gives us the maximum
  // to validate against and lets us ignore any column id that isn't ours.
  const { data: columns, error: colErr } = await supabase
    .from("score_columns")
    .select("id, label, max_score")
    .eq("course_id", courseId)
    .returns<{ id: string; label: string; max_score: number }[]>();
  if (colErr) return fail(colErr.message);
  const columnById = new Map<string, { id: string; label: string; max_score: number }>(
    (columns ?? []).map((c) => [c.id, c] as const),
  );

  // Field names look like: score__<studentId>__<columnId>
  const toUpsert: { column_id: string; student_id: string; value: number }[] = [];
  // Cleared cells, grouped by column so they delete in one query per column
  // rather than one query per cell.
  const clearedByColumn = new Map<string, string[]>();

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith("score__")) continue;
    const [, studentId, columnId] = key.split("__");
    const column = columnById.get(columnId);
    if (!studentId || !column) continue;

    const text = String(raw).trim();
    if (text === "") {
      const cleared = clearedByColumn.get(columnId);
      if (cleared) cleared.push(studentId);
      else clearedByColumn.set(columnId, [studentId]);
      continue;
    }
    const value = Number(text);
    if (Number.isNaN(value) || value < 0) {
      return fail(`Invalid score "${text}".`);
    }
    if (value > Number(column.max_score)) {
      return fail(`${column.label}: ${value} is above the maximum of ${column.max_score}.`);
    }
    toUpsert.push({ column_id: columnId, student_id: studentId, value });
  }

  for (const batch of chunk(toUpsert, BATCH_SIZE)) {
    const { error } = await supabase
      .from("scores")
      .upsert(batch, { onConflict: "column_id,student_id" });
    if (error) return fail(error.message);
  }

  for (const [columnId, studentIds] of clearedByColumn) {
    for (const batch of chunk(studentIds, BATCH_SIZE)) {
      const { error } = await supabase
        .from("scores")
        .delete()
        .eq("column_id", columnId)
        .in("student_id", batch);
      if (error) return fail(error.message);
    }
  }

  revalidatePath(`/admin/courses/${courseId}`);
  return ok;
}
