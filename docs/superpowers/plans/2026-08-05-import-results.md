# Import Results From a File — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a lecturer import per-assessment scores for a whole class from a wide gradebook CSV (pasted or uploaded) on the course admin page.

**Architecture:** Mirror the existing student-import feature. A new server action `importResults` in `src/app/admin/actions.ts` parses a wide CSV (index column + one column per assessment), matches headers to existing `score_columns` by label, looks up/enrolls students via the service-role client, and inserts scores for blank cells only. A new client component `import-results-form.tsx` provides the paste/upload UI via `useActionState`, rendered in the "Enter results" section of `page.tsx`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase (`@supabase/ssr` + service-role admin client), TypeScript, Tailwind v4.

## Global Constraints

- **No test runner exists** in this project. "Verify" steps mean: `npm run lint`, `npm run build`, and manual checks against the dev server (`npm run dev`). Do not add a test framework.
- **Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code** (per AGENTS.md — this Next.js has breaking changes vs. training data). Specifically skim the Server Actions guide before editing `actions.ts`.
- **No database schema changes.** Use existing tables: `courses`, `students`, `enrollments`, `score_columns`, `scores`.
- **Reuse existing helpers** in `actions.ts`: `splitCsvLine`, `assertCourseOwner`, `createAdminClient`, and the `ActionState` / `ok` / `fail` values. Do not duplicate them.
- **Server action signature** must be `(_prev: ActionState, formData: FormData) => Promise<ActionState>` to match `useActionState` usage, exactly like the sibling actions.
- **Fill-blanks-only policy:** never overwrite or clear an existing score. Only insert scores for cells that are (a) non-empty in the file and (b) currently unset for that student/column.
- **Partial-success reporting:** per-row/per-cell problems and unmatched headers are collected and returned in the `error` field as a summary (this is the established pattern in `importStudents`), truncated to the first ~5 items. A fully clean import returns `{ error: null, ok: true }`.

---

### Task 1: `importResults` server action

**Files:**
- Modify: `src/app/admin/actions.ts` (add near `importStudents`, ~line 332)

**Interfaces:**
- Consumes (already defined in this file): `type ActionState = { error: string | null; ok?: boolean }`; `const ok: ActionState`; `const fail = (error: string) => ActionState`; `async function assertCourseOwner(courseId): { supabase, userId }`; `function createAdminClient()` (imported from `@/lib/supabase/admin`); `function splitCsvLine(line: string): string[]`.
- Produces: `export async function importResults(_prev: ActionState, formData: FormData): Promise<ActionState>` — consumed by Task 2's form.

- [ ] **Step 1: Read the Next.js Server Actions guide**

Run: `ls node_modules/next/dist/docs/` then read the server-actions / mutating-data guide file it lists. Confirm the `useActionState` + server action contract matches how `importStudents` is written (it does — follow that exact shape).

- [ ] **Step 2: Add the `importResults` action**

Add this function to `src/app/admin/actions.ts`, immediately after `importStudents` (after its closing brace, ~line 332). It reuses `splitCsvLine`, `assertCourseOwner`, `createAdminClient`, `ok`, `fail`.

```ts
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
    if (col) mapped.push({ pos, column: col });
    else unmatchedHeaders.push(h);
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

  const toInsert: { column_id: string; student_id: string; value: number }[] = [];
  const errors: string[] = [];
  const studentsScored = new Set<string>();
  let enrolledNew = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const indexNumber = (cells[indexCol] ?? "").trim();
    if (!indexNumber) continue;

    const { data: student } = await admin
      .from("students")
      .select("id")
      .eq("index_number", indexNumber)
      .maybeSingle();
    if (!student) {
      errors.push(`${indexNumber}: not found`);
      continue;
    }

    // Ensure enrollment (idempotent; ignore duplicate).
    const { error: enrollErr } = await supabase
      .from("enrollments")
      .insert({ course_id: courseId, student_id: student.id });
    if (enrollErr && !enrollErr.message.toLowerCase().includes("duplicate")) {
      errors.push(`${indexNumber}: ${enrollErr.message}`);
      continue;
    }
    if (!enrollErr) enrolledNew++;

    for (const m of mapped) {
      const key = `${student.id}__${m.column.id}`;
      const raw = (cells[m.pos] ?? "").trim();
      if (raw === "") continue; // blank in file → skip
      if (filled.has(key)) continue; // already has a value → keep
      const value = Number(raw);
      if (Number.isNaN(value) || value < 0 || value > Number(m.column.max_score)) {
        errors.push(`${indexNumber}/${m.column.label}: invalid`);
        continue;
      }
      toInsert.push({ column_id: m.column.id, student_id: student.id, value });
      filled.add(key); // guard against duplicate rows in the same file
      studentsScored.add(student.id);
    }
  }

  if (toInsert.length) {
    const { error } = await supabase.from("scores").insert(toInsert);
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
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors referencing `actions.ts`. (`revalidatePath` is already imported at the top of the file.)

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/actions.ts
git commit -m "feat: add importResults server action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `ImportResultsForm` UI component

**Files:**
- Create: `src/app/admin/courses/[id]/import-results-form.tsx`

**Interfaces:**
- Consumes: `importResults` and `type ActionState` from `../../actions` (Task 1).
- Produces: `export default function ImportResultsForm({ courseId }: { courseId: string })` — consumed by Task 3's `page.tsx`.

- [ ] **Step 1: Create the component**

Modeled exactly on `import-students-form.tsx` (same collapse-on-success pattern), with copy describing the gradebook layout.

```tsx
"use client";

import { useActionState, useState } from "react";
import { importResults, type ActionState } from "../../actions";

const initial: ActionState = { error: null };

export default function ImportResultsForm({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState(importResults, initial);
  const [open, setOpen] = useState(false);

  // Collapse on a clean success. Collapsing unmounts the form, so its inputs
  // reset naturally on the next open (adjust-state-during-render pattern).
  const [wasOk, setWasOk] = useState(false);
  if (state.ok && !wasOk) {
    setWasOk(true);
    setOpen(false);
  } else if (!state.ok && wasOk) {
    setWasOk(false);
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(true)} className="btn-secondary">
          Import results from CSV
        </button>
        {state.ok && <span className="text-sm text-green-600">Import complete ✓</span>}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-slate-200 p-4">
      <input type="hidden" name="courseId" value={courseId} />
      <p className="text-sm text-slate-600">
        First column is the student <code>index number</code>; each remaining
        column header must match one of this course&apos;s score columns by name.
        Only blank cells are filled — existing scores are kept. Unknown headers
        and unknown index numbers are skipped and reported.
      </p>
      <textarea
        name="csv"
        rows={5}
        className="input font-mono text-xs"
        placeholder={"index, Assignment, Exam\nUEB0101220, 18, 62\nUEB0101221, 15, 55"}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-slate-500">
          …or upload a file:{" "}
          <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Importing…" : "Import results"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
          Cancel
        </button>
        {state.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors referencing `import-results-form.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/courses/\[id\]/import-results-form.tsx
git commit -m "feat: add ImportResultsForm UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire the form into the course page

**Files:**
- Modify: `src/app/admin/courses/[id]/page.tsx` (import at top ~line 11; render inside the "Enter results" section, ~lines 190-210)

**Interfaces:**
- Consumes: `ImportResultsForm` default export (Task 2).

- [ ] **Step 1: Add the import**

Add alongside the other course-page imports (after the `ImportStudentsForm` import, ~line 8):

```tsx
import ImportResultsForm from "./import-results-form";
```

- [ ] **Step 2: Render the form in the "Enter results" section**

In the `{/* Scores grid */}` section, the current body is a ternary: a "add a column and a student" hint when there are none, else `<ScoresGrid ... />`. Replace that block so the import form shows whenever there is at least one column and one student (it needs columns to match headers and students to score), sitting above the grid.

Find (around lines 197-209):

```tsx
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
```

Replace with:

```tsx
        {cols.length === 0 || students.length === 0 ? (
          <p className="text-sm text-slate-400">
            Add at least one score column and one student to enter results.
          </p>
        ) : (
          <>
            <ImportResultsForm courseId={course.id} />
            <ScoresGrid
              courseId={course.id}
              columns={cols.map((c) => ({ id: c.id, label: c.label, maxScore: c.max_score }))}
              students={students}
              scoreMap={scoreMap}
              overallScore={course.overall_score}
            />
          </>
        )}
```

- [ ] **Step 3: Verify build**

Run: `npm run lint && npm run build`
Expected: build succeeds, no errors in `page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/courses/\[id\]/page.tsx
git commit -m "feat: show ImportResultsForm on course page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Manual end-to-end verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (needs `.env.local` with Supabase keys, already present).

- [ ] **Step 2: Prepare a course**

Sign in as a lecturer, open a course, and ensure it has at least two score columns (e.g. `Assignment` max 20, `Exam` max 70) and at least one enrolled student (e.g. `UEB0101220`). Note a second index number that exists globally but is NOT enrolled here, and pick an index like `UEB9999` that exists nowhere.

- [ ] **Step 2b: Optionally pre-fill one cell**

In the grid, give `UEB0101220` an `Assignment` score (e.g. 10) and Save — this lets you confirm fill-blanks-only.

- [ ] **Step 3: Import a CSV exercising every branch**

Open "Import results from CSV", paste (substitute real index numbers):

```
index, Assignment, Exam, Midterm
UEB0101220, 18, 62, 40
<unenrolled-but-real-index>, 15, 55, 30
UEB9999, 12, 50, 20
UEB0101220, 99, 999, 10
```

Click Import results. **Expected summary** (order/wording may vary):
- Scores imported for the enrolled + newly-enrolled students.
- `Midterm` reported as an unmatched header.
- `UEB9999: not found` reported.
- The over-max `Exam` value `999` for the last row reported as invalid (and `99` skipped because `Assignment` is now already filled).

- [ ] **Step 4: Confirm the grid**

Reload the course page. Verify in the grid:
- `UEB0101220` Assignment is still **10** (kept, not overwritten to 18/99).
- `UEB0101220` Exam is **62** (was blank → filled).
- The previously-unenrolled student now appears, with Assignment 15 / Exam 55.
- No `Midterm` column was created.

- [ ] **Step 5: Confirm clean-import path**

Import a CSV with only valid, matched, blank-target cells and confirm the form collapses and shows "Import complete ✓" with no error text.

- [ ] **Step 6: Final commit (if any doc updates)**

If verification surfaced copy tweaks, make them and commit. Otherwise nothing to commit — the feature is complete.

---

## Self-Review

- **Spec coverage:** File shape (Task 1 header parse), match-existing-columns-only + report unmatched (Task 1 `unmatchedHeaders`), enroll-if-exists-else-skip (Task 1 student lookup + enroll), fill-blanks-only (Task 1 `filled` set), skip-bad-cell-and-report (Task 1 validation), UI panel with paste + upload (Task 2), placement in Enter results section (Task 3), manual testing plan (Task 4). All spec sections map to a task.
- **Placeholder scan:** No TBD/TODO; all code shown in full.
- **Type consistency:** `ActionState`, `importResults` signature, and `ImportResultsForm({ courseId })` prop match across Tasks 1-3. `filled` key format `${studentId}__${columnId}` used consistently. `max_score` compared via `Number(...)` (it is `numeric` in Postgres → may arrive as string).
