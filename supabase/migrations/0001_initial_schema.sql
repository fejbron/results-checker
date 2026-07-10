-- Results Checker — initial schema
-- Run this in the Supabase SQL editor (or via the Supabase CLI) once per project.

-- Needed for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Lecturers/admins own courses. auth.uid() comes from Supabase Auth.
create table if not exists public.courses (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  code         text not null,
  -- Grade scale: ordered list of { min_percent, letter }, highest first.
  grade_scale  jsonb not null default '[
    {"min": 80, "letter": "A"},
    {"min": 70, "letter": "B"},
    {"min": 60, "letter": "C"},
    {"min": 50, "letter": "D"},
    {"min": 0,  "letter": "F"}
  ]'::jsonb,
  created_at   timestamptz not null default now()
);

-- Students are global (an index number is unique across the institution).
create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  index_number  text not null unique,
  full_name     text not null,
  -- bcrypt hash of the student's PIN. Never store the plain PIN.
  pin_hash      text not null,
  created_at    timestamptz not null default now()
);

-- Which students belong to which course.
create table if not exists public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (course_id, student_id)
);

-- Configurable score columns, defined per course.
create table if not exists public.score_columns (
  id             uuid primary key default gen_random_uuid(),
  course_id      uuid not null references public.courses (id) on delete cascade,
  label          text not null,
  max_score      numeric not null default 100 check (max_score > 0),
  display_order  int not null default 0,
  created_at     timestamptz not null default now()
);

-- A single score: one student, one column.
create table if not exists public.scores (
  id          uuid primary key default gen_random_uuid(),
  column_id   uuid not null references public.score_columns (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  value       numeric not null check (value >= 0),
  updated_at  timestamptz not null default now(),
  unique (column_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_courses_owner on public.courses (owner_id);
create index if not exists idx_enrollments_course on public.enrollments (course_id);
create index if not exists idx_enrollments_student on public.enrollments (student_id);
create index if not exists idx_score_columns_course on public.score_columns (course_id);
create index if not exists idx_scores_column on public.scores (column_id);
create index if not exists idx_scores_student on public.scores (student_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Lecturers (authenticated users) may only touch data belonging to courses
-- they own. The student-facing lookup runs server-side with the service-role
-- key, which bypasses RLS, AFTER the PIN has been verified — so students never
-- get a Supabase session and no public read policy is needed.
-- ---------------------------------------------------------------------------
alter table public.courses       enable row level security;
alter table public.students      enable row level security;
alter table public.enrollments   enable row level security;
alter table public.score_columns enable row level security;
alter table public.scores        enable row level security;

-- Courses: owner-only.
create policy "courses_owner_all" on public.courses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Students: an authenticated lecturer may see/manage students enrolled in one
-- of their courses. (Service-role bypasses this for the student lookup.)
create policy "students_lecturer_read" on public.students
  for select using (
    exists (
      select 1
      from public.enrollments e
      join public.courses c on c.id = e.course_id
      where e.student_id = students.id and c.owner_id = auth.uid()
    )
  );

-- Students may be created/updated by any authenticated lecturer (they are
-- shared across the institution). Deletion is restricted to service-role.
create policy "students_lecturer_insert" on public.students
  for insert to authenticated with check (true);
create policy "students_lecturer_update" on public.students
  for update to authenticated using (true) with check (true);

-- Enrollments: only for the lecturer's own courses.
create policy "enrollments_owner_all" on public.enrollments
  for all using (
    exists (select 1 from public.courses c where c.id = enrollments.course_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.courses c where c.id = enrollments.course_id and c.owner_id = auth.uid())
  );

-- Score columns: only for the lecturer's own courses.
create policy "score_columns_owner_all" on public.score_columns
  for all using (
    exists (select 1 from public.courses c where c.id = score_columns.course_id and c.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.courses c where c.id = score_columns.course_id and c.owner_id = auth.uid())
  );

-- Scores: only for columns that belong to the lecturer's own courses.
create policy "scores_owner_all" on public.scores
  for all using (
    exists (
      select 1
      from public.score_columns sc
      join public.courses c on c.id = sc.course_id
      where sc.id = scores.column_id and c.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1
      from public.score_columns sc
      join public.courses c on c.id = sc.course_id
      where sc.id = scores.column_id and c.owner_id = auth.uid()
    )
  );
