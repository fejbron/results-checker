-- Tighten the `students` write policies.
--
-- 0001 granted every authenticated user blanket INSERT/UPDATE on `students`
-- (`with check (true)` / `using (true)`), because students are institution-wide
-- rather than owned by one lecturer. The effect was that any signed-in lecturer
-- holding only the anon key could rewrite ANY student's `index_number` or
-- `pin_hash` — including students on courses they have nothing to do with.
--
-- Nothing in the app relies on those policies: every student insert/update goes
-- through the service-role client (`createAdminClient`), which bypasses RLS
-- entirely, and only after the lecturer's course ownership has been checked.
-- The read policy (`students_lecturer_read`) is what the admin UI actually uses
-- and is left in place.
drop policy if exists "students_lecturer_insert" on public.students;
drop policy if exists "students_lecturer_update" on public.students;
