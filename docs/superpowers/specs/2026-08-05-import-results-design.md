# Import results from a file — design

**Date:** 2026-08-05
**Status:** Approved, ready for implementation plan

## Problem

Lecturers currently enter results one cell at a time in the scores grid on the
course page. For a large class this is slow and error-prone. They already have
marks in a spreadsheet. We want to let them import those marks from a CSV file
(pasted or uploaded) in one shot.

Note: importing **students** already exists (`ImportStudentsForm` +
`importStudents` action). This feature is the parallel for **results/scores**.

## Scope

In scope:

- A new "Import results" panel on the course admin page.
- A new `importResults` server action that parses a wide gradebook CSV and
  writes scores.

Out of scope:

- Any database schema change.
- Exporting results.
- Editing/creating score columns during import (unmatched headers are reported,
  not created).

## File format

Wide gradebook CSV. Header row is **required**.

```
index,      Assignment, Exam
UEB0101220, 18,         62
UEB0101221, 15,         55
```

- **First column** = student index number. The header cell is identified by
  matching `/index/i`; if no header matches, the first column (index 0) is used
  as the index column.
- **Remaining columns** = assessment scores. Each header is matched
  **case-insensitively** (trimmed) to the course's existing `score_columns` by
  `label`.
- Reuse the existing `splitCsvLine` helper for quote-aware CSV parsing.

## Behavior (decisions)

1. **Unknown headers** — a header that matches no existing score column is
   skipped and reported. Columns are **not** auto-created.
2. **Unknown / unenrolled students** — look up the index number globally
   (service-role client):
   - matches a known student who is **not enrolled** in this course → enroll
     them, then import their scores;
   - matches **no** student anywhere → skip the row and report it (we never
     invent a student with no name).
3. **Overwrite policy** — **only fill blanks**. If a saved score already exists
   for a student/column, it is left untouched. If the file cell is empty, it is
   skipped (never clears an existing score).
4. **Bad values** — a cell that is non-numeric or outside `0 … max_score` is
   skipped and reported per row. One bad cell never fails the whole import;
   every valid cell still imports.

## Components

### UI: `src/app/admin/courses/[id]/import-results-form.tsx` (new)

- Client component modeled on `import-students-form.tsx`:
  - Collapsed state → a "Import results" secondary button.
  - Expanded state → a `<form action={action}>` with:
    - hidden `courseId`;
    - a short help paragraph describing the format (index column + one column
      per assessment, matched by header name);
    - a `<textarea name="csv">` for pasting;
    - an `<input type="file" name="file" accept=".csv,text/csv,text/plain">`;
    - submit + cancel buttons; inline error/success text from `state`.
  - Same collapse-on-success pattern (`wasOk` mirror) as the students form.
- Rendered in `page.tsx` inside the **Enter results** section, above/near
  `ScoresGrid`. Only meaningful when the course has ≥1 column and ≥1 possible
  student, but it can render whenever columns exist; the action reports if there
  is nothing to match.

### Server action: `importResults(prev, formData)` in `src/app/admin/actions.ts` (new)

Signature matches the other actions: `(_prev: ActionState, formData: FormData) => Promise<ActionState>`.

Steps:

1. Read `courseId`. Read text from `file` (if uploaded and non-empty) else from
   the `csv` field; trim. If empty → `fail("Paste CSV rows or choose a file to import.")`.
2. `assertCourseOwner(courseId)` → `supabase`. Create `admin` service-role client.
3. Load the course's `score_columns` (`id, label, max_score`). Build a
   label→column map keyed by `label.trim().toLowerCase()`.
4. Split text into lines (reuse the `split(/\r?\n/)` + trim + filter pattern).
   The first line is the header. `splitCsvLine` it. Determine the index column
   position and, for each other header, resolve to a column id or record the
   header as unmatched.
   - If no data rows or no headers map to a real column → `fail(...)` with a
     helpful message.
5. Preload existing scores for the course's columns into a
   `Set<"studentId__columnId">` (or `{studentId: Set<columnId>}`) so we can
   cheaply check "already has a value".
6. For each data row:
   - Read the index number (trim). Empty → skip silently.
   - Look up the student by `index_number` via `admin` (`maybeSingle`).
     - Not found → report `"<index>: not found"`, continue.
   - Ensure enrollment: insert into `enrollments` (ignore duplicate error), like
     the existing `enrollStudent` helper does. Count a fresh enrollment.
   - For each mapped column cell:
     - If the file cell is empty → skip.
     - If the student already has a saved score for that column → skip (fill
       blanks only).
     - Parse number; if `NaN` or `< 0` or `> max_score` → report
       `"<index>/<label>: invalid"`, continue.
     - Push `{ column_id, student_id, value }` to the insert batch and mark it
       in the "already has" set so duplicate rows in the same file don't double.
7. If the insert batch is non-empty → `supabase.from("scores").insert(batch)`
   (plain insert, not upsert — we only ever add rows that had no value).
8. `revalidatePath(\`/admin/courses/${courseId}\`)`.
9. Build a summary string in the existing style and return. On any skips,
   return them in `error` (the students import reuses the `error` field for a
   partial-success summary); on a fully clean import return `{ error: null, ok: true }`.

### Reuse

- `splitCsvLine`, `assertCourseOwner`, `createAdminClient`, the
  enroll-ignoring-duplicate pattern, and the `ActionState`/`ok`/`fail` helpers
  already in `actions.ts`.

## Data flow

```
CSV text ─▶ parse header ─▶ {indexCol, [{col,label}], unmatchedHeaders}
        └─▶ per row ─▶ lookup student ─▶ enroll ─▶ per mapped cell:
                fill-blank + validate ─▶ insert batch
insert batch ─▶ scores table ─▶ revalidate ─▶ grid shows new fills
```

## Error handling

- Not owner / not authenticated → thrown by `assertCourseOwner` (same as
  sibling actions).
- Empty input, no mappable columns, no rows → early `fail(...)` with guidance.
- Per-row / per-cell problems are collected and reported in the summary; they
  never abort the import.
- DB insert error → `fail(error.message)`.

## Testing

Manual end-to-end via the running app (no test runner in this project):

- CSV with a matched header and an unmatched header → unmatched reported, matched
  imported.
- Row for an enrolled student, a known-but-unenrolled student (enrolled + scored),
  and a totally unknown index (reported).
- A blank cell (skipped), a cell for a column the student already has (kept), and
  a normal blank-target cell (filled).
- An over-max value and a non-numeric value → both reported, rest imported.
- Confirm the scores grid reflects exactly the expected fills and the summary
  lists the rest.
```
