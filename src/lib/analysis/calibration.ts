import { clamp } from "@/lib/utils";

/**
 * Baked from the listed-name walk-forward (point-in-time prices only).
 * Live 1-month confidence shrinks toward these frequencies so 80% is not a stamp.
 * Updated after each long backtest run.
 */
export const BAKED_RISE = {
  n: 62,
  hit: 0.6612903225806451 as number | null,
  asOf: "2026-09-02",
  note: "Listed-name 10-year walk-forward (~30-day holds): 66% of 62 rise calls were up a month later. Sat out the 2020 crash and 2022. Last 12 months: 77% of 13. Group leaders that were beating the market; no 1-month rise on non-US listings vs this tape.",
};

export function displayConfidence(
  formula: number,
  priorHit: number | null,
  priorN: number,
): number {
  if (priorHit == null || priorN < 10) {
    return clamp(Math.min(Math.round(formula), 68), 52, 68);
  }
  const emp = Math.round(priorHit * 100);
  // History pulls the number, but a name that passed the 70% rule can still print 70–78.
  const w = clamp(priorN / 80, 0.25, 0.4);
  return clamp(Math.round(w * emp + (1 - w) * Math.min(formula, 86)), 52, 80);
}

export function priorRiseStats(
  rows: Array<{
    decisionDate: string;
    forecastDirection: string;
    abstain: boolean;
    actualReturn: number;
  }>,
  asOfDate: string,
): { n: number; hit: number | null } {
  const prior = rows.filter(
    (r) =>
      r.decisionDate < asOfDate &&
      r.forecastDirection === "Increase" &&
      !r.abstain,
  );
  if (!prior.length) return { n: 0, hit: null };
  const hits = prior.filter((r) => r.actualReturn > 0.005).length;
  return { n: prior.length, hit: hits / prior.length };
}
