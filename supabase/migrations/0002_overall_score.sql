-- Optional per-course "overall score": the denominator the combined score
-- columns are scaled to (e.g. all columns graded over 40 or 60).
-- NULL means "use the raw sum of the column maximums" (original behaviour).
alter table public.courses
  add column if not exists overall_score numeric check (overall_score is null or overall_score > 0);
