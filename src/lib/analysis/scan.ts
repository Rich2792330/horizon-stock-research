import { analyzeTicker, DISCLAIMER } from "./framework";
import { prefetchMacro } from "./market-data";
import { livePeerSnaps, isForeignListing, isLeveredEtf } from "./peer-tape";
import { SCAN_UNIVERSE } from "./scan-universe";
import type { Direction, TickerAnalysis } from "./types";

export { SCAN_UNIVERSE } from "./scan-universe";
export const SCAN_UNIVERSE_SIZE = SCAN_UNIVERSE.length;

export const RISER_MIN_CONFIDENCE = 70;

export interface ScanOutlook {
  direction: Direction;
  confidence: number;
  expectedReturn: number;
  abstain: boolean;
  whyConfident?: string;
}

export interface ScanHit {
  ticker: string;
  name: string;
  price: number | null;
  direction: Direction;
  confidence: number;
  score: number;
  expectedReturn: number;
  ciLow: number;
  ciHigh: number;
  ciLevel: number;
  abstain: boolean;
  keyDrivers: string;
  whyConfident?: string;
  sector: string | null;
  industry: string | null;
  liquidityFlag: string;
  frictionBps: number | null;
  ret21d: number | null;
  ret63d: number | null;
  h3?: ScanOutlook;
  h6?: ScanOutlook;
}

export interface RiserScanReport {
  asOf: string;
  minConfidence: number;
  horizon: "1m";
  universeSize: number;
  scanned: number;
  failed: number;
  durationMs: number;
  hits: ScanHit[];
  nearMisses: ScanHit[];
  notes: string[];
  disclaimer: string;
  offset?: number;
  done?: boolean;
  pool?: ScanHit[];
  phase?: "searching" | "testing" | "done";
}

/** 70%+ rise next month only. Drop 3x ETFs, non-US listings, and 3-month down conflicts. */
export function qualifyingRise(
  h: ScanHit,
  min = RISER_MIN_CONFIDENCE,
): { horizon: "1m"; confidence: number } | null {
  if (isForeignListing(h.ticker) || isLeveredEtf(h.ticker)) return null;
  if (h.liquidityFlag === "low") return null;
  if (h.h3 && h.h3.direction === "Decrease" && !h.h3.abstain) return null;
  if (h.direction === "Increase" && !h.abstain && h.confidence >= min) {
    return { horizon: "1m", confidence: h.confidence };
  }
  return null;
}

export function clearedRise70(h: ScanHit, min = RISER_MIN_CONFIDENCE): number {
  return qualifyingRise(h, min)?.confidence ?? 0;
}

export function toHit(r: TickerAnalysis): ScanHit | null {
  const h1 = r.horizons.find((h) => h.horizon === "1m");
  const h3 = r.horizons.find((h) => h.horizon === "3m");
  const h6 = r.horizons.find((h) => h.horizon === "6m");
  if (!h1 || r.error) return null;
  const slice = (h: typeof h1): ScanOutlook => ({
    direction: h.direction,
    confidence: h.confidence,
    expectedReturn: h.expectedReturn,
    abstain: h.abstain,
    whyConfident: h.whyConfident,
  });
  return {
    ticker: r.ticker,
    name: r.snapshot?.name ?? r.ticker,
    price: r.snapshot?.price ?? null,
    direction: h1.direction,
    confidence: h1.confidence,
    score: h1.score,
    expectedReturn: h1.expectedReturn,
    ciLow: h1.ciLow,
    ciHigh: h1.ciHigh,
    ciLevel: h1.ciLevel,
    abstain: h1.abstain,
    keyDrivers: r.keyDrivers,
    whyConfident: h1.whyConfident,
    sector: r.snapshot?.sector ?? null,
    industry: r.snapshot?.industry ?? null,
    liquidityFlag: r.risk.liquidityFlag,
    frictionBps: r.risk.estimatedRoundTripBps,
    ret21d: r.snapshot?.ret21d ?? null,
    ret63d: r.snapshot?.ret63d ?? null,
    h3: h3 ? slice(h3) : undefined,
    h6: h6 ? slice(h6) : undefined,
  };
}

export async function scanHighConfidenceRisers(opts?: {
  universe?: string[];
  minConfidence?: number;
  maxTickers?: number;
  offset?: number;
  limit?: number;
  confirmTickers?: string[];
}): Promise<RiserScanReport> {
  const t0 = Date.now();
  const minConfidence = opts?.minConfidence ?? RISER_MIN_CONFIDENCE;
  const maxTickers = opts?.maxTickers ?? 500;

  if (opts?.confirmTickers?.length) {
    const [macro, peerSnaps] = await Promise.all([prefetchMacro("2y"), livePeerSnaps()]);
    const tickers = [...new Set(opts.confirmTickers.map((t) => t.toUpperCase().trim()))].slice(0, 20);
    const results: TickerAnalysis[] = [];
    for (const t of tickers) {
      try {
        results.push(await analyzeTicker(t, { ...macro, peerSnaps }));
      } catch (e) {
        results.push({
          ticker: t,
          snapshot: null,
          modules: [],
          horizons: [],
          risk: {
            realizedVol21d: null,
            realizedVol63d: null,
            betaSpy: null,
            maxDrawdown6m: null,
            avgDollarVolume: null,
            liquidityFlag: "unknown",
            estimatedRoundTripBps: null,
            stressScenarios: [],
            riskNotes: [],
          },
          keyDrivers: "",
          methodologyNote: "",
          error: e instanceof Error ? e.message : "Confirm failed",
        });
      }
    }
    const hitsAll = results.map(toHit).filter((h): h is ScanHit => h != null);
    const hits = hitsAll
      .filter((h) => clearedRise70(h, minConfidence) >= minConfidence)
      .sort(
        (a, b) =>
          b.expectedReturn - a.expectedReturn ||
          clearedRise70(b, minConfidence) - clearedRise70(a, minConfidence),
      );
    const nearMisses = hitsAll
      .filter((h) => !hits.some((x) => x.ticker === h.ticker))
      .sort((a, b) => b.confidence - a.confidence || b.score - a.score);
    return {
      asOf: new Date().toISOString(),
      minConfidence,
      horizon: "1m",
      universeSize: tickers.length,
      scanned: results.length,
      failed: results.filter((r) => r.error).length,
      durationMs: Date.now() - t0,
      hits,
      nearMisses,
      notes: hits.length
        ? [`Kept ${hits.length} at ${minConfidence}%+ next month.`]
        : [`None at ${minConfidence}% sure to rise next month.`],
      disclaimer: DISCLAIMER,
      done: true,
      phase: "done",
    };
  }

  const [macro, peerSnaps] = await Promise.all([prefetchMacro("2y"), livePeerSnaps()]);
  const universe = (opts?.universe ?? SCAN_UNIVERSE).slice(0, maxTickers);
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? universe.length;
  const slice = universe.slice(offset, offset + limit);
  const results: TickerAnalysis[] = [];
  const queue = [...slice];
  const concurrency = Math.min(6, Math.max(1, slice.length));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        try {
          results.push(await analyzeTicker(t, { ...macro, peerSnaps, light: true }));
        } catch (e) {
          results.push({
            ticker: t,
            snapshot: null,
            modules: [],
            horizons: [],
            risk: {
              realizedVol21d: null,
              realizedVol63d: null,
              betaSpy: null,
              maxDrawdown6m: null,
              avgDollarVolume: null,
              liquidityFlag: "unknown",
              estimatedRoundTripBps: null,
              stressScenarios: [],
              riskNotes: [],
            },
            keyDrivers: "",
            methodologyNote: "",
            error: e instanceof Error ? e.message : "Scan item failed",
          });
        }
      }
    }),
  );

  const failed = results.filter((r) => r.error || !r.horizons.length).length;
  const hitsAll = results.map(toHit).filter((h): h is ScanHit => h != null);
  const hits = hitsAll
    .filter((h) => clearedRise70(h, minConfidence) >= minConfidence && h.liquidityFlag !== "low")
    .sort(
      (a, b) =>
        b.expectedReturn - a.expectedReturn ||
        clearedRise70(b, minConfidence) - clearedRise70(a, minConfidence),
    );
  const nearMisses = hitsAll
    .filter((h) => h.direction === "Increase" && !h.abstain && h.confidence < minConfidence)
    .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
    .slice(0, 20);

  return {
    asOf: new Date().toISOString(),
    minConfidence,
    horizon: "1m",
    universeSize: universe.length,
    scanned: results.length,
    failed,
    durationMs: Date.now() - t0,
    hits,
    nearMisses,
    notes: [
      `Ran the model on ${results.length} names.`,
      hits.length
        ? `Kept ${hits.length} at ${minConfidence}%+ next month.`
        : `None at ${minConfidence}% sure to rise next month.`,
    ],
    disclaimer: DISCLAIMER,
    offset,
    done: true,
    phase: "done",
    pool: hitsAll.slice(0, 40),
  };
}
