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

const round2 = (n: number) => Math.round(n * 100) / 100;

// Compute total, max, percentage and grade from a set of column values.
//
// `overallScore` (optional) scales the combined columns to a chosen denominator
// — e.g. mark everything out of 40. When null/undefined the raw sum of the
// column maximums is used. The returned `mark`/`outOf` are what to display as
// the total; `percentage` and `grade` are unaffected by the scaling.
export function computeResult(
  columns: { maxScore: number; value: number | null }[],
  scale?: GradeBand[],
  overallScore?: number | null,
) {
  const total = columns.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const maxTotal = columns.reduce((sum, c) => sum + c.maxScore, 0);
  const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  const grade = letterForPercentage(percentage, scale);

  const outOf = overallScore != null ? overallScore : maxTotal;
  // When outOf === maxTotal this equals `total`; otherwise it scales linearly.
  const mark = maxTotal > 0 ? round2((total / maxTotal) * outOf) : 0;

  return {
    total,
    maxTotal,
    percentage: round2(percentage),
    grade,
    mark,
    outOf: round2(outOf),
  };
}
