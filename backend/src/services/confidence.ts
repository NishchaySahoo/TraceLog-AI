export interface ConfidenceInput {
  similarities: number[]; // Cosine similarities of cited chunks (sorted descending)
  validCitedRefs: number;
  totalRefsReturnedByModel: number;
  insufficientContext?: boolean;
}

export interface ConfidenceBreakdown {
  score: number;
  top1: number;
  margin: number;
  coverage: number;
}

export function computeConfidence(input: ConfidenceInput): ConfidenceBreakdown {
  if (input.insufficientContext || input.similarities.length === 0) {
    return {
      score: 0,
      top1: 0,
      margin: 0,
      coverage: 0
    };
  }

  const sorted = [...input.similarities].sort((a, b) => b - a);
  const top1 = Math.max(0, Math.min(1, sorted[0]));
  const top2 = sorted.length > 1 ? Math.max(0, Math.min(1, sorted[1])) : 0;

  // margin: 0 if only one chunk, else min((top1 - top2) / 0.15, 1)
  const margin = sorted.length > 1 ? Math.max(0, Math.min(1, (top1 - top2) / 0.15)) : 0;

  // cover: validCitedRefs / max(totalRefsReturnedByModel, 1)
  const denom = Math.max(input.totalRefsReturnedByModel, 1);
  const coverage = Math.max(0, Math.min(1, input.validCitedRefs / denom));

  // confidence = round(100 * (0.6 * top1 + 0.2 * margin + 0.2 * cover))
  const rawScore = 100 * (0.6 * top1 + 0.2 * margin + 0.2 * coverage);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    score,
    top1: Number(top1.toFixed(4)),
    margin: Number(margin.toFixed(4)),
    coverage: Number(coverage.toFixed(4))
  };
}
