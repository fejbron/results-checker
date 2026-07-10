const round2 = (n: number) => Math.round(n * 100) / 100;

// Compute total, max and percentage from a set of column values.
//
// `overallScore` (optional) scales the combined columns to a chosen denominator
// — e.g. mark everything out of 40. When null/undefined the raw sum of the
// column maximums is used. The returned `mark`/`outOf` are what to display as
// the total; `percentage` is unaffected by the scaling.
export function computeResult(
  columns: { maxScore: number; value: number | null }[],
  overallScore?: number | null,
) {
  const total = columns.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const maxTotal = columns.reduce((sum, c) => sum + c.maxScore, 0);
  const percentage = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

  const outOf = overallScore != null ? overallScore : maxTotal;
  // When outOf === maxTotal this equals `total`; otherwise it scales linearly.
  const mark = maxTotal > 0 ? round2((total / maxTotal) * outOf) : 0;

  return {
    total,
    maxTotal,
    percentage: round2(percentage),
    mark,
    outOf: round2(outOf),
  };
}
