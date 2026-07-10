// Shared domain types mirroring the Supabase schema.

export type GradeBand = { min: number; letter: string };

export type Course = {
  id: string;
  owner_id: string;
  name: string;
  code: string;
  grade_scale: GradeBand[];
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

export const DEFAULT_GRADE_SCALE: GradeBand[] = [
  { min: 80, letter: "A" },
  { min: 70, letter: "B" },
  { min: 60, letter: "C" },
  { min: 50, letter: "D" },
  { min: 0, letter: "F" },
];

// Shape returned to the student after a successful lookup.
export type CourseResult = {
  courseId: string;
  courseName: string;
  courseCode: string;
  columns: { label: string; maxScore: number; value: number | null }[];
  total: number;
  maxTotal: number;
  percentage: number;
  grade: string;
};
