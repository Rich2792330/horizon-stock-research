import { clamp } from "@/lib/utils";

export function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

export function mean(arr: number[]): number | null {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stdev(arr: number[]): number | null {
  if (arr.length < 2) return null;
  const m = mean(arr)!;
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

export function returnsFromCloses(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0 && cur > 0) out.push(cur / prev - 1);
  }
  return out;
}

export function periodReturn(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const a = closes[closes.length - 1 - lookback]!;
  const b = closes[closes.length - 1]!;
  if (a <= 0 || b <= 0) return null;
  return b / a - 1;
}

export function sma(closes: number[], window: number): number | null {
  if (closes.length < window) return null;
  const slice = closes.slice(-window);
  return mean(slice);
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

/** Annualized realized vol from daily returns */
export function realizedVol(dailyReturns: number[], window: number): number | null {
  if (dailyReturns.length < window) return null;
  const slice = dailyReturns.slice(-window);
  const s = stdev(slice);
  if (s == null) return null;
  return s * Math.sqrt(252);
}

export function maxDrawdown(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0]!;
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) {
      const dd = c / peak - 1;
      if (dd < maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

/** OLS beta of asset vs market using aligned daily returns */
export function beta(assetR: number[], marketR: number[]): number | null {
  const n = Math.min(assetR.length, marketR.length);
  if (n < 30) return null;
  const a = assetR.slice(-n);
  const m = marketR.slice(-n);
  const ma = mean(a)!;
  const mm = mean(m)!;
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i]! - ma) * (m[i]! - mm);
    varM += (m[i]! - mm) ** 2;
  }
  if (varM === 0) return null;
  return cov / varM;
}

export function zscore(value: number, series: number[]): number | null {
  const m = mean(series);
  const s = stdev(series);
  if (m == null || s == null || s === 0) return null;
  return (value - m) / s;
}

/** Soft squash to [-1, 1] */
export function tanhScore(x: number, scale = 1): number {
  return Math.tanh(x / scale);
}

export function alignLen(a: number[], b: number[]): [number[], number[]] {
  const n = Math.min(a.length, b.length);
  return [a.slice(-n), b.slice(-n)];
}

export function scoreBand(
  value: number | null,
  thresholds: { low: number; high: number },
  invert = false,
): number {
  if (value == null || Number.isNaN(value)) return 0;
  let s: number;
  if (value <= thresholds.low) s = -1;
  else if (value >= thresholds.high) s = 1;
  else {
    const mid = (thresholds.low + thresholds.high) / 2;
    const half = (thresholds.high - thresholds.low) / 2 || 1;
    s = clamp((value - mid) / half, -1, 1);
  }
  return invert ? -s : s;
}
