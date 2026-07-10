// Shared domain types mirroring the Supabase schema.

export type Course = {
  id: string;
  owner_id: string;
  name: string;
  code: string;
  // Optional denominator the combined columns are scaled to (e.g. 40 or 60).
  // NULL = use the raw sum of the column maximums.
  overall_score: number | null;
  created_at: string;
};

export type Student = {
  id: string;
  index_number: string;
  full_name: string;
  pin_hash: string;
  created_at: string;
};

export type ScoreColumn = {
  id: string;
  course_id: string;
  label: string;
  max_score: number;
  display_order: number;
  created_at: string;
};

export type Score = {
  id: string;
  column_id: string;
  student_id: string;
  value: number;
  updated_at: string;
};

// Shape returned to the student after a successful lookup.
export type CourseResult = {
  courseId: string;
  courseName: string;
  courseCode: string;
  columns: { label: string; maxScore: number; value: number | null }[];
  // Displayed total: `mark` out of `outOf` (already scaled to the course's
  // overall score when one is set).
  mark: number;
  outOf: number;
  percentage: number;
};
