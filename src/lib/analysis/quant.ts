import { clamp } from "@/lib/utils";
import type { MarketSnapshot, TickerAnalysis } from "./types";
import { tanhScore } from "./indicators";
import { quantGroup } from "./listed";

/** Ranking weights from the quant chart, slightly rebalanced so we do not only chase price. */
export const QUANT_WEIGHTS = {
  momentum: 0.28,
  value: 0.22,
  quality: 0.25,
  lowVol: 0.15,
  other: 0.1,
} as const;

export interface QuantRaw {
  momentum: number | null;
  value: number | null;
  quality: number | null;
  lowVol: number | null;
  other: number | null;
  notes: string[];
}

export function rawQuantFactors(snap: MarketSnapshot, vol63: number | null, beta: number | null): QuantRaw {
  const notes: string[] = [];

  let momentum: number | null = null;
  if (snap.ret21d != null && snap.ret63d != null) {
    momentum = snap.ret21d - snap.ret63d;
    notes.push(
      `Momentum: last 20 trading days ${pct(snap.ret21d)} minus last 60 days ${pct(snap.ret63d)}`,
    );
  }

  let value: number | null = null;
  if (snap.peApprox != null && snap.peApprox > 0) {
    value = -Math.log(snap.peApprox);
    notes.push(`Value: cheaper P/E (~${snap.peApprox.toFixed(1)}) scores higher`);
  } else if (snap.pbApprox != null && snap.pbApprox > 0) {
    value = -Math.log(snap.pbApprox);
    notes.push(`Value: cheaper P/B (~${snap.pbApprox.toFixed(1)}) scores higher`);
  }

  let quality = 0;
  let qn = 0;
  if (snap.roe != null) {
    quality += tanhScore(snap.roe, 0.18);
    qn++;
    notes.push(`Quality: ROE ${pct(snap.roe)}`);
  }
  if (snap.profitMargin != null) {
    quality += tanhScore(snap.profitMargin, 0.12);
    qn++;
  }
  if (snap.debtEquity != null) {
    quality += tanhScore(0.8 - snap.debtEquity, 0.8);
    qn++;
    notes.push(`Quality: debt/equity ${snap.debtEquity.toFixed(2)} (lower is better)`);
  }
  if (snap.niGrowthYoy != null) {
    const stable = Math.abs(snap.niGrowthYoy) < 0.8 ? 0.15 : -0.15;
    quality += tanhScore(snap.niGrowthYoy, 0.25) + stable;
    qn++;
  }
  const qualityScore = qn ? quality / qn : null;

  let lowVol: number | null = null;
  if (vol63 != null || beta != null) {
    const v = vol63 != null ? -vol63 / 0.35 : 0;
    const b = beta != null ? -(beta - 1) / 0.8 : 0;
    lowVol = clamp((v + b) / (vol63 != null && beta != null ? 2 : 1), -2.5, 2.5);
    notes.push(
      `Low vol: ${vol63 != null ? `vol ${(vol63 * 100).toFixed(0)}%` : ""}${beta != null ? ` β ${beta.toFixed(2)}` : ""} — calmer scores higher`,
    );
  }

  let other = 0;
  let on = 0;
  if (snap.niGrowthYoy != null) {
    other += tanhScore(snap.niGrowthYoy, 0.2);
    on++;
  }
  if (snap.dividendYield != null) {
    other += tanhScore(snap.dividendYield, 0.03);
    on++;
    notes.push(`Other: dividend ${pct(snap.dividendYield)}`);
  }
  if (snap.governance?.insiderSignal) {
    other += snap.governance.insiderSignal * 0.5;
    on++;
  }
  const otherScore = on ? other / on : null;

  return {
    momentum,
    value,
    quality: qualityScore,
    lowVol,
    other: otherScore,
    notes: notes.slice(0, 6),
  };
}

function pct(n: number): string {
  const s = n > 0 ? "+" : "";
  return `${s}${(n * 100).toFixed(1)}%`;
}

function zOf(xs: (number | null)[]): (number | null)[] {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 4) {
    return xs.map((x) => (x == null ? null : clamp(x, -2.5, 2.5)));
  }
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
  return xs.map((x) => (x == null ? null : clamp((x - mean) / sd, -3, 3)));
}

export function attachQuantRanks(results: TickerAnalysis[]): void {
  const live = results.filter((r) => r.snapshot && !r.error);
  if (live.length < 2) {
    for (const r of live) {
      const raw = r.quantRaw;
      if (!raw) continue;
      r.quantScore = composite(raw, false);
    }
    return;
  }

  const groupOf = (r: TickerAnalysis) =>
    quantGroup(r.ticker, r.snapshot?.industry, r.snapshot?.sector);

  const groups = new Map<string, TickerAnalysis[]>();
  for (const r of live) {
    const g = groupOf(r);
    const list = groups.get(g) ?? [];
    list.push(r);
    groups.set(g, list);
  }

  for (const members of groups.values()) {
    const pool = members.length >= 4 ? members : live;
    const cols = {
      momentum: zOf(pool.map((r) => r.quantRaw?.momentum ?? null)),
      value: zOf(pool.map((r) => r.quantRaw?.value ?? null)),
      quality: zOf(pool.map((r) => r.quantRaw?.quality ?? null)),
      lowVol: zOf(pool.map((r) => r.quantRaw?.lowVol ?? null)),
      other: zOf(pool.map((r) => r.quantRaw?.other ?? null)),
    };
    const index = new Map(pool.map((r, i) => [r, i]));
    for (const r of members) {
      const i = index.get(r);
      if (i == null) continue;
      r.quantScore = composite(
        {
          momentum: cols.momentum[i] ?? 0,
          value: cols.value[i] ?? 0,
          quality: cols.quality[i] ?? 0,
          lowVol: cols.lowVol[i] ?? 0,
          other: cols.other[i] ?? 0,
          notes: r.quantRaw?.notes ?? [],
        },
        true,
      );
    }
  }

  const ranked = [...live].sort((a, b) => (b.quantScore ?? 0) - (a.quantScore ?? 0));
  ranked.forEach((r, i) => {
    r.quantRank = i + 1;
  });
}

function composite(raw: QuantRaw, alreadyZ: boolean): number {
  const w = QUANT_WEIGHTS;
  const parts: Array<[number | null, number]> = [
    [raw.momentum, w.momentum],
    [raw.value, w.value],
    [raw.quality, w.quality],
    [raw.lowVol, w.lowVol],
    [raw.other, w.other],
  ];
  let num = 0;
  let den = 0;
  for (const [v, wt] of parts) {
    if (v == null || !Number.isFinite(v)) continue;
    const x = alreadyZ ? v : clamp(v, -2.5, 2.5);
    num += wt * x;
    den += wt;
  }
  return den ? num / den : 0;
}

