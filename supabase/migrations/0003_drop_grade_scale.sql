-- The grade scale / letter-grade feature was removed. Results now show a mark
-- (optionally scaled to a per-course overall score) and a percentage only.
alter table public.courses
  drop column if exists grade_scale;
