import { fetchChart, type BarSeries } from "./market-data";
import { periodReturn } from "./indicators";
import { quantGroup } from "./listed";

/** Liquid tape used to rank “is this a top winner this month?” */
export const PEER_TAPE = [
  "AAPL", "MSFT", "NVDA", "GOOG", "AMZN", "META", "AVGO", "TSLA", "SPCX",
  "JPM", "V", "UNH", "XOM", "LLY", "JNJ", "COST", "WMT", "HD",
  "PG", "KO", "DIS", "NFLX", "AMD", "ORCL", "CRM", "CSCO", "INTC",
  "QCOM", "AMAT", "MU", "LRCX", "KLAC", "NOW", "PLTR", "UBER",
  "TSM", "ASML", "ARM", "MRVL", "BA", "CAT", "GE", "RTX",
  "RCL", "BKNG", "AMGN", "PFE", "BAC", "GS", "WFC",
  "SPY", "QQQ", "IWM", "SMH", "XLK", "XLF", "XLE", "XLV",
  "GLD", "TLT", "HYG", "IWF", "VUG", "VTI",
  "COIN", "CRWD", "PANW", "APP", "ANET", "VRT", "AXON",
  "NVO", "SAP", "BABA", "PDD", "MELI",
] as const;

const GROUP_HINT: Record<string, string> = {
  NVDA: "semis", AMD: "semis", INTC: "semis", QCOM: "semis", AVGO: "semis",
  TSM: "semis", ASML: "semis", AMAT: "semis", KLAC: "semis", MU: "semis",
  LRCX: "semis", MRVL: "semis", ARM: "semis", SMH: "semis",
  AAPL: "big-tech", MSFT: "big-tech", GOOG: "big-tech", AMZN: "big-tech",
  META: "big-tech", NFLX: "big-tech", ORCL: "big-tech", CRM: "big-tech",
  NOW: "big-tech", PLTR: "big-tech",
  CRWD: "cyber", PANW: "cyber", FTNT: "cyber",
  TSLA: "auto", RCL: "travel", BKNG: "travel",
  GLD: "metals", IAU: "metals", SLV: "metals", PLTM: "metals",
  QQQ: "etf", SPY: "etf", IWM: "etf", XLK: "etf", XLF: "etf",
  XLE: "etf", XLV: "etf", IWF: "etf", VUG: "etf", VTI: "etf", TLT: "etf", HYG: "etf",
  SPCX: "space",
};

export function tapeGroup(ticker: string): string {
  return GROUP_HINT[ticker] ?? quantGroup(ticker);
}

/** Korea/Tokyo/etc close on a different clock than SPY — 1M US-tape rank is not fair. */
export function isForeignListing(ticker: string): boolean {
  return /\.(KS|KQ|T|HK|L|PA|DE|AX|TO|SW)$/i.test(ticker);
}

const LEVERED = new Set([
  "SOXL", "SOXS", "TQQQ", "SQQQ", "UPRO", "SPXU", "SPXL", "SPXS",
  "TNA", "TZA", "UWM", "QLD", "QID", "SSO", "SDS", "USD", "TBT",
  "TMF", "TMV", "UVXY", "SVXY", "TECL", "TECS", "FAS", "FAZ", "TQQ",
]);

export function isLeveredEtf(ticker: string): boolean {
  return LEVERED.has(ticker.toUpperCase());
}

export type PeerSnap = { ticker: string; r21: number; r63: number };

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

export function snapsFromBars(
  bars: Map<string, BarSeries>,
  asOfTs?: number,
): PeerSnap[] {
  const out: PeerSnap[] = [];
  for (const [ticker, bar] of bars) {
    const i = asOfTs != null ? idxOnOrBefore(bar, asOfTs) : bar.closes.length - 1;
    if (i < 70) continue;
    const closes = bar.closes.slice(0, i + 1);
    const r21 = periodReturn(closes, 21);
    const r63 = periodReturn(closes, 63);
    if (r21 == null || r63 == null) continue;
    out.push({ ticker, r21, r63 });
  }
  return out;
}

/** 0–1: share of uptrend peers this name beats on 21d. 1 = strongest. */
export function peerPercentile(peers: PeerSnap[], r21: number, r63: number): number | null {
  const up = peers.filter((p) => p.r63 > 0);
  if (up.length < 12) return null;
  const beaten = up.filter((p) => r21 > p.r21).length;
  return beaten / up.length;
}

export function isTopLeader(peers: PeerSnap[], r21: number | null, r63: number | null): boolean {
  if (r21 == null || r63 == null || r63 <= 0) return false;
  const pct = peerPercentile(peers, r21, r63);
  if (pct == null) return false;
  return pct >= 0.88;
}

/** Leader vs its own group (semis vs semis), not vs gold + cruise + QQQ. */
export function isGroupLeader(
  peers: PeerSnap[],
  ticker: string,
  r21: number | null,
  r63: number | null,
): boolean {
  if (r21 == null || r63 == null || r63 <= 0 || r21 <= 0) return false;
  const g = tapeGroup(ticker);
  const same = peers.filter((p) => tapeGroup(p.ticker) === g && p.r63 > 0);
  if (same.length < 4) return isTopLeader(peers, r21, r63);
  const beaten = same.filter((p) => r21 > p.r21).length;
  return beaten / same.length >= 0.7;
}

const tapeCache = new Map<string, BarSeries>();
let tapePromise: Promise<Map<string, BarSeries>> | null = null;

export async function loadPeerBars(): Promise<Map<string, BarSeries>> {
  if (tapeCache.size >= 40) return tapeCache;
  if (tapePromise) return tapePromise;
  tapePromise = (async () => {
    const q = [...PEER_TAPE];
    const fill = Promise.all(
      Array.from({ length: 5 }, async () => {
        while (q.length) {
          const t = q.shift()!;
          if (tapeCache.has(t)) continue;
          try {
            const b = await fetchChart(t, "2y");
            if (b && b.closes.length >= 80) tapeCache.set(t, b);
          } catch {
            /* skip */
          }
        }
      }),
    );
    await Promise.race([
      fill,
      new Promise((resolve) => setTimeout(resolve, 12_000)),
    ]);
    return tapeCache;
  })();
  try {
    return await tapePromise;
  } finally {
    tapePromise = null;
  }
}

export async function livePeerSnaps(): Promise<PeerSnap[]> {
  const bars = await loadPeerBars();
  return snapsFromBars(bars);
}
