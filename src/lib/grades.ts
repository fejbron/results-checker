import type { GradeBand } from "@/lib/types";
import { DEFAULT_GRADE_SCALE } from "@/lib/types";

// Map a percentage (0-100) to a letter using the course's grade scale.
export function letterForPercentage(
  percentage: number,
  scale: GradeBand[] = DEFAULT_GRADE_SCALE,
): string {
  const bands = [...scale].sort((a, b) => b.min - a.min);
  for (const band of bands) {
    if (percentage >= band.min) return band.letter;
  }
  return bands.length ? bands[bands.length - 1].letter : "-";
}

// Compute total, max, percentage and grade from a set of column values.
export function computeResult(
  columns: { maxScore: number; value: number | null }[],
  scale?: GradeBand[],
) {
  const total = columns.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const maxTotal = columns.reduce((sum, c) => sum + c.maxScore, 0);
  const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const grade = letterForPercentage(percentage, scale);
  return {
    total,
    maxTotal,
    percentage: Math.round(percentage * 100) / 100,
    grade,
  };
}
