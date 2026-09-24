import { clamp, round } from "@/lib/utils";
import { periodReturn, rsi, sma } from "./indicators";
import type { BarSeries } from "./market-data";

export interface TrainedOutlook {
  expectedReturn: number;
  residualVol: number;
  pUp: number;
  n: number;
  used: boolean;
}

function idxOnOrBefore(bar: BarSeries, ts: number): number {
  const t = bar.timestamps;
  if (!t.length) return 0;
  let lo = 0;
  let hi = t.length - 1;
  if (ts < t[0]!) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid]! <= ts) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function retAt(closes: number[], end: number, lookback: number): number | null {
  if (end < lookback || end >= closes.length) return null;
  const a = closes[end - lookback]!;
  const b = closes[end]!;
  if (!(a > 0) || !(b > 0)) return null;
  return b / a - 1;
}

function levelDiff(closes: number[], end: number, lookback: number): number | null {
  if (end < lookback || end >= closes.length) return null;
  return closes[end]! - closes[end - lookback]!;
}

function alignedRet(series: BarSeries | null, ts: number, lookback: number): number | null {
  if (!series || series.closes.length < lookback + 2) return null;
  const i = idxOnOrBefore(series, ts);
  return retAt(series.closes, i, lookback);
}

function alignedDiff(series: BarSeries | null, ts: number, lookback: number): number | null {
  if (!series || series.closes.length < lookback + 2) return null;
  const i = idxOnOrBefore(series, ts);
  return levelDiff(series.closes, i, lookback);
}

/** Features through bar index `end` only (point-in-time). */
export function featuresAt(
  bar: BarSeries,
  end: number,
  spy: BarSeries | null,
  tnx: BarSeries | null,
): number[] | null {
  const closes = bar.closes.slice(0, end + 1);
  if (closes.length < 80) return null;
  const ts = bar.timestamps[end]!;
  const lastI = closes.length - 1;
  const r63 = retAt(closes, lastI, 63);
  const r5 = retAt(closes, lastI, 5);
  const r21 = retAt(closes, lastI, 21);
  const spy21 = alignedRet(spy, ts, 21);
  const tnx21 = alignedDiff(tnx, ts, 21);
  const rsi14 = rsi(closes, 14);
  const sma50 = sma(closes, 50);
  const px = closes[lastI]!;
  if (r63 == null || r5 == null || r21 == null) return null;
  return [
    1,
    r63,
    r5,
    spy21 != null ? r21 - spy21 : 0,
    spy21 ?? 0,
    tnx21 ?? 0,
    rsi14 != null ? (rsi14 - 50) / 25 : 0,
    sma50 != null && px > sma50 ? 1 : 0,
  ];
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r]![i]!) > Math.abs(M[piv]![i]!)) piv = r;
    }
    if (Math.abs(M[piv]![i]!) < 1e-10) return null;
    [M[i], M[piv]] = [M[piv]!, M[i]!];
    const div = M[i]![i]!;
    for (let c = i; c <= n; c++) M[i]![c]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r]![i]!;
      for (let c = i; c <= n; c++) M[r]![c]! -= f * M[i]![c]!;
    }
  }
  return M.map((row) => row[n]!);
}

function ridgeFit(X: number[][], y: number[], lambda: number): { beta: number[]; rmse: number } | null {
  const n = y.length;
  const p = X[0]?.length ?? 0;
  if (n < p + 8 || p < 2) return null;
  const xtx: number[][] = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i]!;
    for (let a = 0; a < p; a++) {
      xty[a] += xi[a]! * y[i]!;
      for (let b = 0; b < p; b++) xtx[a]![b]! += xi[a]! * xi[b]!;
    }
  }
  for (let a = 1; a < p; a++) xtx[a]![a]! += lambda;
  const beta = solve(xtx, xty);
  if (!beta) return null;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    let hat = 0;
    for (let a = 0; a < p; a++) hat += beta[a]! * X[i]![a]!;
    const e = y[i]! - hat;
    sse += e * e;
  }
  return { beta, rmse: Math.sqrt(sse / Math.max(1, n - p)) };
}

function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp((-z * z) / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Walk-forward ridge: features known at t → next `horizonDays` return.
 * Samples every 8 sessions, never using bars after `endIdx`.
 */
export function trainOutlook(
  bar: BarSeries,
  spy: BarSeries | null,
  tnx: BarSeries | null,
  horizonDays: number,
  endIdx?: number,
): TrainedOutlook {
  const last = endIdx ?? bar.closes.length - 1;
  const X: number[][] = [];
  const y: number[] = [];
  const step = horizonDays <= 30 ? 8 : horizonDays <= 80 ? 12 : 16;
  const minEnd = 80;
  const maxDecision = last - horizonDays;
  for (let d = minEnd; d <= maxDecision; d += step) {
    const feat = featuresAt(bar, d, spy, tnx);
    const fwd = retAt(bar.closes, d + horizonDays, horizonDays);
    if (!feat || fwd == null || !Number.isFinite(fwd)) continue;
    X.push(feat);
    y.push(fwd);
  }
  const fitted = ridgeFit(X, y, 2.2);
  const now = featuresAt(bar, last, spy, tnx);
  if (!fitted || !now) {
    const fallback = periodReturn(bar.closes.slice(0, last + 1), Math.min(horizonDays, 63)) ?? 0;
    return {
      expectedReturn: round(clamp(fallback * 0.15, -0.25, 0.25), 4),
      residualVol: 0.08,
      pUp: 0.5,
      n: y.length,
      used: false,
    };
  }
  let mu = 0;
  for (let a = 0; a < fitted.beta.length; a++) mu += fitted.beta[a]! * now[a]!;
  const sigma = clamp(fitted.rmse, 0.03, 0.45);
  mu = clamp(mu, -0.9 * sigma, 0.9 * sigma);
  let pUp = clamp(normCdf(mu / sigma), 0.08, 0.92);
  const n = y.length;
  const shrink = n / (n + 16);
  pUp = 0.5 + (pUp - 0.5) * shrink;
  if (horizonDays <= 30 && sigma > 0.22) {
    pUp = 0.5 + (pUp - 0.5) * clamp(0.22 / sigma, 0.45, 1);
  }
  pUp = clamp(pUp, 0.12, 0.86);
  return {
    expectedReturn: round(mu, 4),
    residualVol: round(sigma, 4),
    pUp: round(pUp, 3),
    n,
    used: true,
  };
}

export function outlookToCall(
  o: TrainedOutlook,
  friction: number,
): { direction: "Increase" | "Decrease" | "Neutral"; confidence: number; abstain: boolean } {
  const edge = Math.max(0.008, friction);
  if (!o.used || Math.abs(o.expectedReturn) < edge * 0.8) {
    return { direction: "Neutral", confidence: clamp(Math.round(50 + (o.pUp - 0.5) * 30), 44, 58), abstain: true };
  }
  if (o.expectedReturn > edge && o.pUp >= 0.56) {
    return {
      direction: "Increase",
      confidence: clamp(Math.round(o.pUp * 100), 52, 78),
      abstain: false,
    };
  }
  if (o.expectedReturn < -edge && o.pUp <= 0.44) {
    return {
      direction: "Decrease",
      confidence: clamp(Math.round((1 - o.pUp) * 100), 52, 78),
      abstain: false,
    };
  }
  return {
    direction: "Neutral",
    confidence: clamp(Math.round(50 + (o.pUp - 0.5) * 40), 46, 58),
    abstain: Math.abs(o.expectedReturn) < edge,
  };
}
