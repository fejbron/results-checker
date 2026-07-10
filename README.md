# Results Checker

A results-checking app for schools. Lecturers sign in to manage courses, define
their own score columns (assignment, presentation, project, exam — anything),
enroll students and enter results. Students look up their own results with their
index number and a PIN.

- **Framework:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Database & Auth:** Supabase (Postgres + Auth)
- **Hosting:** Vercel

## Features

- **Admin (lecturer) side** — email/password sign-in via Supabase Auth.
  - Create courses.
  - Configure **per-course** score columns with a maximum score each.
  - A configurable, per-course **grade scale** (letter grades by percentage).
  - Enroll students by index number; auto-assign a default PIN (last 4 digits of
    the index number) or set/reset a custom PIN.
  - **Bulk-import students from CSV** (`index number, full name, PIN` — PIN
    optional; header row auto-detected).
  - Enter results in a grid with live totals, percentages and grades.
  - **Forgot-password / reset-password** flow via Supabase Auth email.
- **Student side** — no account needed.
  - Look up results with **index number + PIN**.
  - See every enrolled course with per-column scores, total, percentage and grade.
- **Security** — Postgres Row Level Security ensures lecturers only touch their
  own courses. The student lookup runs server-side with the service-role key and
  returns data only after the PIN (bcrypt-hashed) is verified.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the dashboard, open **SQL Editor** and run the migration in
   [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql).
3. Create your first lecturer account: **Authentication → Users → Add user**
   (set an email + password, and mark it as confirmed). Repeat for each lecturer.
4. Collect your keys from **Project Settings → API**:
   - Project URL
   - `anon` public key
   - `service_role` secret key
5. For the password-reset flow, add your app URLs under **Authentication → URL
   Configuration → Redirect URLs**, e.g. `http://localhost:3000/auth/callback`
   and `https://your-app.vercel.app/auth/callback`.

## 2. Run locally

```bash
cp .env.example .env.local   # then fill in the three values
npm install
npm run dev
```

- Student results page: <http://localhost:3000>
- Admin sign-in: <http://localhost:3000/admin>

## 3. Deploy to Vercel

1. Push this repo to GitHub and import it at [vercel.com/new](https://vercel.com/new).
2. Add the three environment variables (Project → Settings → Environment
   Variables), matching `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` (optional but recommended — your deployed URL, for
     password-reset email links)
3. Deploy. That's it — Fluid Compute runs the server actions (including bcrypt)
   on Node.js with no extra configuration.

> Tip: with the Vercel CLI you can push env vars straight from your local file:
> `vercel env pull` / `vercel env add`.

## How it fits together

| Area | Path |
| --- | --- |
| Database schema + RLS | `supabase/migrations/0001_initial_schema.sql` |
| Supabase clients | `src/lib/supabase/{client,server,admin}.ts` |
| Grade computation | `src/lib/grades.ts` |
| Auth guard | `src/middleware.ts` |
| Admin actions | `src/app/admin/actions.ts`, `src/app/admin/auth-actions.ts` |
| Admin UI | `src/app/admin/**` |
| Student lookup | `src/app/student-actions.ts`, `src/app/results-checker.tsx` |

## Notes

- **Index numbers are unique** across the institution; a student created in one
  course can be enrolled in others and re-uses the same PIN.
- Tell students their default PIN is the **last 4 digits of their index number**
  unless a lecturer set a custom one.
- Grade scales are stored per course as JSON, e.g.
  `[{"min":80,"letter":"A"},{"min":70,"letter":"B"}, ...]`. A band applies when
  the overall percentage is at least `min`.
