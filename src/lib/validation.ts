import { z } from "zod";

export const gradeBandSchema = z.object({
  min: z.coerce.number().min(0).max(100),
  letter: z.string().trim().min(1).max(4),
});

export const courseSchema = z.object({
  name: z.string().trim().min(1, "Course name is required").max(120),
  code: z.string().trim().min(1, "Course code is required").max(40),
  grade_scale: z.array(gradeBandSchema).min(1).optional(),
});

export const scoreColumnSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(80),
  max_score: z.coerce.number().gt(0, "Max score must be greater than 0"),
});

export const studentSchema = z.object({
  index_number: z.string().trim().min(1, "Index number is required").max(60),
  full_name: z.string().trim().min(1, "Full name is required").max(160),
  // Optional on create: defaults to last 4 chars of index number.
  pin: z.string().trim().min(4, "PIN must be at least 4 characters").max(20).optional(),
});

export const studentLookupSchema = z.object({
  index_number: z.string().trim().min(1, "Enter your index number"),
  pin: z.string().trim().min(1, "Enter your PIN"),
});

// A PIN reset for an existing student.
export const pinResetSchema = z.object({
  pin: z.string().trim().min(4, "PIN must be at least 4 characters").max(20),
});
