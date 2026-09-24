import { formatPct, round } from "@/lib/utils";
import {
  fetchChart,
  fetchFundamentals,
  fetchGovernance,
  fetchNewsSentiment,
  fetchSearchMeta,
  type BarSeries,
  type Fundamentals,
  type RawBundle,
} from "./market-data";
import { emptySocialBundle, fetchSocialSentimentBundle } from "./social";
import type { SocialSentimentBundle } from "./social";
import { scoreModules, synthesizeHorizons, blendTrainedOutlook } from "./framework";
import type {
  Direction,
  GovernanceBundle,
  QualityBundle,
  SentimentBundle,
} from "./types";
import { buildQualityFromFund } from "./quality";
import { isGroupLeader, snapsFromBars } from "./peer-tape";
import { LISTED_STOCKS, TICKER_PROFILE, quantGroup } from "./listed";
import { SCAN_UNIVERSE } from "./scan";
import { displayConfidence, priorRiseStats } from "./calibration";
import { realizedVol, returnsFromCloses } from "./indicators";
import { cacheDelete } from "./cache";
import {
  BANNER_RULE,
  classifyTape,
  tapeInputsFromBars,
  type TapeLabel,
  type TapeReading,
} from "./tape-regime";

export const BACKTEST_UNIVERSE = [...LISTED_STOCKS] as const;

export const FORWARD_DAYS = 21;
/** ~6.5 years of 21-day windows so 2020 and 2022 are in the sample. */
export const WALK_PERIODS = 80;
export const BACKTEST_RANGE = "10y";

export interface BacktestRow {
  ticker: string;
  name: string;
  period: number;
  decisionDate: string;
  evalDate: string;
  priceAtDecision: number;
  priceAtEval: number;
  actualReturn: number;
  actualDirection: Direction;
  forecastDirection: Direction;
  forecastConfidence: number;
  forecastScore: number;
  abstain: boolean;
  hit: boolean | null;
  directionalHit: boolean | null;
  signedPnLProxy: number;
  spyReturn: number | null;
  beatSpy: boolean | null;
  highConf70: boolean;
  tape?: TapeLabel;
  error?: string;
}

export interface PeriodSummary {
  period: number;
  decisionDate: string;
  evalDate: string;
  n: number;
  nDirectional: number;
  directionalHitRate: number | null;
  scoreReturnCorr: number | null;
  avgReturnWhenIncrease: number | null;
  longShortSpread: number | null;
  tape?: TapeLabel;
  spyReturn?: number | null;
}

export interface RegimeSummary {
  label: string;
  from: string;
  to: string;
  n: number;
  nIncrease: number;
  n70: number;
  increaseHitRate: number | null;
  hit70: number | null;
}

export interface BannerMonth {
  decisionDate: string;
  evalDate: string;
  tape: TapeLabel;
  reasons: string[];
  flipBack: string[];
  suppressRiseCalls: boolean;
  spyReturn: number | null;
  spyNegative: boolean;
  /** Equal-weight 1-month return of names that held up best (metals + lowest 63d vol). */
  holdUpReturn: number | null;
  /** Equal-weight 1-month return of names that were breaking down (worst 21d). */
  breakDownReturn: number | null;
  nHoldUp: number;
  nBreakDown: number;
  holdUpNames: string[];
  breakDownNames: string[];
  /** What a 1-month rise call would have returned if we had not sat out. */
  ifWeHadCalledRise: number | null;
}

export interface BannerTestSummary {
  nMonths: number;
  nBear: number;
  nBull: number;
  nChoppy: number;
  bearSpyHit: number | null;
  /** Share of Bear months where SPY fell over the next month. */
  bearSpyDownRate: number | null;
  /** Share of Bull months where SPY rose. */
  bullSpyUpRate: number | null;
  /** In Bear months, did the "holding up" list lose less than SPY? */
  holdUpBeatSpyInBear: number | null;
  holdUpAvgInBear: number | null;
  spyAvgInBear: number | null;
  /** In Bear months, did sitting out beat blindly calling rises on the list? */
  sitOutVsCallingRiseInBear: number | null;
  year2022: {
    nMonths: number;
    nBear: number;
    nBull: number;
    nChoppy: number;
    bearSpyDownRate: number | null;
    holdUpBeatSpyInBear: number | null;
    holdUpAvgInBear: number | null;
    spyAvgInBear: number | null;
    listAvgInBear: number | null;
    months: BannerMonth[];
  };
  year2020: {
    nMonths: number;
    nBear: number;
    nBull: number;
    nChoppy: number;
    bearSpyDownRate: number | null;
    holdUpBeatSpyInBear: number | null;
    holdUpAvgInBear?: number | null;
    spyAvgInBear?: number | null;
    listAvgInBear?: number | null;
    months: BannerMonth[];
  };
  notes: string[];
}

export interface BacktestSummary {
  n: number;
  nDirectional: number;
  nIncrease: number;
  n70: number;
  directionalHitRate: number | null;
  increaseHitRate: number | null;
  hit70: number | null;
  beatSpyRate: number | null;
  scoreReturnCorr: number | null;
  avgReturnWhenIncrease: number | null;
  avgReturnWhenDecrease: number | null;
  longShortSpread: number | null;
  brierLike: number | null;
  notes: string[];
  regimes: RegimeSummary[];
  banner?: BannerTestSummary;
}

export interface BacktestReport {
  asOf: string;
  decisionDate: string;
  evalDate: string;
  forwardDays: number;
  walkPeriods: number;
  universe: string[];
  rows: BacktestRow[];
  latestRows: BacktestRow[];
  periods: PeriodSummary[];
  summary: BacktestSummary;
}

interface TickerCache {
  bar: BarSeries;
  meta: { name: string; sector: string | null; industry: string | null };
  fundamentals: Fundamentals;
  sentiment: SentimentBundle;
  social: SocialSentimentBundle;
  governance: GovernanceBundle;
  quality: QualityBundle;
}

function isoDate(tsSec: number): string {
  return new Date(tsSec * 1000).toISOString().slice(0, 10);
}

function actualDirectionFromReturn(r: number): Direction {
  if (r > 0.005) return "Increase";
  if (r < -0.005) return "Decrease";
  return "Neutral";
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

function sliceBarAsOf(bar: BarSeries, asOfIdx: number): BarSeries {
  const end = Math.min(asOfIdx + 1, bar.closes.length);
  const closes = bar.closes.slice(0, end);
  const volumes = bar.volumes.slice(0, end);
  const timestamps = bar.timestamps.slice(0, end);
  const window = closes.slice(-252);
  const price = closes[closes.length - 1]!;
  return {
    ...bar,
    price,
    closes,
    volumes,
    timestamps,
    high52: window.length ? Math.max(...window) : bar.high52,
    low52: window.length ? Math.min(...window) : bar.low52,
  };
}

function findForwardIdx(bar: BarSeries, decisionIdx: number, forwardDays: number): number | null {
  const target = decisionIdx + forwardDays;
  if (target < bar.closes.length) return target;
  // allow last available if close enough
  if (bar.closes.length - 1 > decisionIdx + Math.floor(forwardDays * 0.7)) {
    return bar.closes.length - 1;
  }
  return null;
}

async function loadTickerCache(ticker: string): Promise<TickerCache | null> {
  const bar = await fetchChart(ticker, "2y");
  if (!bar || bar.closes.length < 80) return null;
  const price = bar.price;
  const [meta, fundamentals, sentiment, governance, social] = await Promise.all([
    fetchSearchMeta(ticker),
    fetchFundamentals(ticker, price),
    fetchNewsSentiment(ticker),
    fetchGovernance(ticker),
    fetchSocialSentimentBundle(ticker, null),
  ]);
  const quality = buildQualityFromFund(fundamentals);
  return {
    bar,
    meta,
    fundamentals,
    sentiment,
    social,
    governance,
    quality,
  };
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

function buildRawAt(
  cache: TickerCache,
  asOfIdx: number,
  spy: BarSeries | null,
  vix: BarSeries | null,
  tnx: BarSeries | null,
  uup: BarSeries | null,
  hyg: BarSeries | null,
): RawBundle {
  const bar = sliceBarAsOf(cache.bar, asOfIdx);
  const ts = cache.bar.timestamps[asOfIdx]!;
  const sliceM = (m: BarSeries | null) => {
    if (!m) return null;
    return sliceBarAsOf(m, idxOnOrBefore(m, ts));
  };
  return {
    bar: {
      ...bar,
      name: cache.meta.name || bar.name,
    },
    spy: sliceM(spy),
    vix: sliceM(vix),
    tnx: sliceM(tnx),
    uup: sliceM(uup),
    hyg: sliceM(hyg),
    meta: cache.meta,
    fundamentals: cache.fundamentals,
    sentiment: cache.sentiment,
    social: cache.social ?? emptySocialBundle(),
    governance: cache.governance,
    quality: cache.quality,
    calendar: {
      daysToEarnings: null,
      earningsLabel: null,
      daysToFed: null,
      daysToCpi: null,
      nextEvent: null,
      notes: ["Backtest uses point-in-time prices; live calendar is not replayed"],
    },
    competitorRel21: null,
    competitorNotes: ["Backtest does not replay live rival tape"],
  };
}

function summarizeRows(rows: BacktestRow[]): Omit<
  BacktestSummary,
  "notes" | "brierLike" | "avgReturnWhenDecrease" | "regimes"
> & { avgReturnWhenDecrease: number | null } {
  const ok = rows.filter((r) => !r.error);
  const dir = ok.filter((r) => r.forecastDirection !== "Neutral" && !r.abstain);
  const hits = dir.filter((r) => r.directionalHit === true);
  const scores = ok.map((r) => r.forecastScore);
  const rets = ok.map((r) => r.actualReturn);
  const inc = ok.filter((r) => r.forecastDirection === "Increase" && !r.abstain);
  const incHits = inc.filter((r) => r.actualReturn > 0.005);
  const hi = inc.filter((r) => r.forecastConfidence >= 70);
  const hiHits = hi.filter((r) => r.actualReturn > 0.005);
  const beat = inc.filter((r) => r.beatSpy === true);
  const dec = ok.filter((r) => r.forecastDirection === "Decrease" && !r.abstain);
  const avgInc =
    inc.length > 0
      ? inc.reduce((a, b) => a + b.actualReturn, 0) / inc.length
      : null;
  const avgDec =
    dec.length > 0
      ? dec.reduce((a, b) => a + b.actualReturn, 0) / dec.length
      : null;
  return {
    n: ok.length,
    nDirectional: dir.length,
    nIncrease: inc.length,
    n70: hi.length,
    directionalHitRate: dir.length ? hits.length / dir.length : null,
    increaseHitRate: inc.length ? incHits.length / inc.length : null,
    hit70: hi.length ? hiHits.length / hi.length : null,
    beatSpyRate: inc.length ? beat.length / inc.length : null,
    scoreReturnCorr: pearson(scores, rets),
    avgReturnWhenIncrease: avgInc,
    avgReturnWhenDecrease: avgDec,
    longShortSpread:
      avgInc != null && avgDec != null
        ? avgInc - avgDec
        : avgInc != null
          ? avgInc
          : null,
  };
}

function periodSummary(period: number, rows: BacktestRow[]): PeriodSummary {
  const base = summarizeRows(rows);
  return {
    period,
    decisionDate: rows[0]?.decisionDate ?? "—",
    evalDate: rows[0]?.evalDate ?? "—",
    n: base.n,
    nDirectional: base.nDirectional,
    directionalHitRate: base.directionalHitRate,
    scoreReturnCorr: base.scoreReturnCorr,
    avgReturnWhenIncrease: base.avgReturnWhenIncrease,
    longShortSpread: base.longShortSpread,
  };
}

function meanRet(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function rateOf(nTrue: number, n: number): number | null {
  if (!n) return null;
  return nTrue / n;
}

function yearSlice(months: BannerMonth[], y: string) {
  return months.filter((m) => m.decisionDate.startsWith(y));
}

function summarizeBannerYear(months: BannerMonth[]) {
  const bear = months.filter((m) => m.tape === "Bear tape");
  const bull = months.filter((m) => m.tape === "Bull tape");
  const choppy = months.filter((m) => m.tape === "Choppy");
  const bearDown = bear.filter((m) => m.spyNegative);
  const holdUpBeat = bear.filter(
    (m) => m.holdUpReturn != null && m.spyReturn != null && m.holdUpReturn > m.spyReturn,
  );
  const listRets = bear.map((m) => m.ifWeHadCalledRise).filter((x): x is number => x != null);
  return {
    nMonths: months.length,
    nBear: bear.length,
    nBull: bull.length,
    nChoppy: choppy.length,
    bearSpyDownRate: rateOf(bearDown.length, bear.length),
    holdUpBeatSpyInBear: rateOf(holdUpBeat.length, bear.length),
    holdUpAvgInBear: meanRet(bear.map((m) => m.holdUpReturn).filter((x): x is number => x != null)),
    spyAvgInBear: meanRet(bear.map((m) => m.spyReturn).filter((x): x is number => x != null)),
    listAvgInBear: meanRet(listRets),
    months,
  };
}

function buildBannerTest(
  months: BannerMonth[],
): BannerTestSummary {
  const all = summarizeBannerYear(months);
  const y2022 = summarizeBannerYear(yearSlice(months, "2022"));
  const y2020 = summarizeBannerYear(yearSlice(months, "2020"));
  const bear = months.filter((m) => m.tape === "Bear tape");
  const bull = months.filter((m) => m.tape === "Bull tape");
  const bullUp = bull.filter((m) => m.spyReturn != null && m.spyReturn > 0);
  const notes: string[] = [];
  notes.push(BANNER_RULE);
  notes.push(
    "v1 (below 200-day + stress) stayed Bear through 2022 bounce months and the hold-up list lagged SPY. v2 requires the 50-day still down and last month still red, and uses metals + calmer names.",
  );
  if (y2022.nMonths) {
    notes.push(
      `2022: ${y2022.nBear} of ${y2022.nMonths} months read Bear tape, ${y2022.nBull} Bull, ${y2022.nChoppy} Choppy.`,
    );
    if (y2022.bearSpyDownRate != null) {
      notes.push(
        `2022 Bear months: SPY fell the next month ${Math.round(y2022.bearSpyDownRate * 100)}% of the time (${y2022.nBear} months).`,
      );
    }
    if (y2022.holdUpBeatSpyInBear != null) {
      notes.push(
        `2022 Bear months: the “holding up” list beat SPY ${Math.round(y2022.holdUpBeatSpyInBear * 100)}% of the time.`,
      );
    }
  }
  if (y2020.nMonths) {
    notes.push(
      `2020: ${y2020.nBear} of ${y2020.nMonths} months read Bear tape. Next-month SPY was down ${y2020.bearSpyDownRate != null ? `${Math.round(y2020.bearSpyDownRate * 100)}%` : "n/a"} of those.`,
    );
  }
  const sitOutVsCall = meanRet(
    bear
      .filter((m) => m.ifWeHadCalledRise != null && m.spyReturn != null)
      .map((m) => 0 - (m.ifWeHadCalledRise as number)),
  );
  return {
    nMonths: all.nMonths,
    nBear: all.nBear,
    nBull: all.nBull,
    nChoppy: all.nChoppy,
    bearSpyHit: all.bearSpyDownRate,
    bearSpyDownRate: all.bearSpyDownRate,
    bullSpyUpRate: rateOf(bullUp.length, bull.length),
    holdUpBeatSpyInBear: all.holdUpBeatSpyInBear,
    holdUpAvgInBear: all.holdUpAvgInBear,
    spyAvgInBear: all.spyAvgInBear,
    sitOutVsCallingRiseInBear: sitOutVsCall,
    year2022: y2022,
    year2020: y2020,
    notes,
  };
}

function tapeAt(
  spy: BarSeries | null,
  vix: BarSeries | null,
  hyg: BarSeries | null,
  ts: number,
): TapeReading {
  const sliceM = (m: BarSeries | null) => {
    if (!m) return null;
    return sliceBarAsOf(m, idxOnOrBefore(m, ts));
  };
  return classifyTape(tapeInputsFromBars(sliceM(spy), sliceM(vix), sliceM(hyg)));
}

function relative21(bar: BarSeries, decIdx: number, spy: BarSeries | null, ts: number): number | null {
  if (decIdx < 21) return null;
  const a = bar.closes[decIdx - 21]!;
  const b = bar.closes[decIdx]!;
  if (!(a > 0) || !(b > 0)) return null;
  const r = b / a - 1;
  if (!spy) return r;
  const sIdx = idxOnOrBefore(spy, ts);
  if (sIdx < 21) return r;
  const sa = spy.closes[sIdx - 21]!;
  const sb = spy.closes[sIdx]!;
  if (!(sa > 0) || !(sb > 0)) return r;
  return r - (sb / sa - 1);
}

function vol63At(bar: BarSeries, decIdx: number): number | null {
  if (decIdx < 64) return null;
  return realizedVol(returnsFromCloses(bar.closes.slice(0, decIdx + 1)), 63);
}

function pickHoldUps(
  monthRets: Array<{
    ticker: string;
    ret: number;
    rel21: number | null;
    vol63: number | null;
    isMetal: boolean;
  }>,
) {
  const metals = monthRets.filter((x) => x.isMetal);
  const rest = monthRets
    .filter((x) => !x.isMetal)
    .sort((a, b) => (a.vol63 ?? 99) - (b.vol63 ?? 99));
  const hold = [...metals, ...rest].slice(0, Math.min(5, monthRets.length));
  const brk = [...monthRets]
    .sort((a, b) => (a.rel21 ?? 0) - (b.rel21 ?? 0))
    .slice(0, Math.min(5, monthRets.length));
  return { hold, brk };
}

/** Recalibrate each rise-call % using only earlier dates (no look-ahead). */
function applyWalkForwardCalibration(rows: BacktestRow[]): void {
  const dates = [...new Set(rows.map((r) => r.decisionDate))].sort();
  const priorByDate = new Map<string, { n: number; hit: number | null }>();
  for (const d of dates) {
    priorByDate.set(d, priorRiseStats(rows, d));
  }
  for (const r of rows) {
    if (r.error) continue;
    if (r.forecastDirection !== "Increase" || r.abstain) continue;
    const prior = priorByDate.get(r.decisionDate) ?? { n: 0, hit: null };
    r.forecastConfidence = displayConfidence(r.forecastConfidence, prior.hit, prior.n);
    r.highConf70 = r.forecastConfidence >= 70;
  }
}

function regimeSlice(
  rows: BacktestRow[],
  label: string,
  from: string,
  to: string,
): RegimeSummary {
  const slice = rows.filter((r) => r.decisionDate >= from && r.decisionDate <= to);
  const base = summarizeRows(slice);
  return {
    label,
    from,
    to,
    n: base.n,
    nIncrease: base.nIncrease,
    n70: base.n70,
    increaseHitRate: base.increaseHitRate,
    hit70: base.hit70,
  };
}

function buildRegimes(rows: BacktestRow[]): RegimeSummary[] {
  const latest = rows.reduce((m, r) => (r.decisionDate > m ? r.decisionDate : m), "");
  let last12From = "0000-01-01";
  if (latest) {
    const d = new Date(`${latest}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      last12From = d.toISOString().slice(0, 10);
    }
  }
  const oldest = rows.reduce((m, r) => (!m || r.decisionDate < m ? r.decisionDate : m), "");
  const byTape = (label: TapeLabel, title: string): RegimeSummary => {
    const slice = rows.filter((r) => r.tape === label);
    const dates = slice.map((r) => r.decisionDate).sort();
    const base = summarizeRows(slice);
    return {
      label: title,
      from: dates[0] || "—",
      to: dates[dates.length - 1] || "—",
      n: base.n,
      nIncrease: base.nIncrease,
      n70: base.n70,
      increaseHitRate: base.increaseHitRate,
      hit70: base.hit70,
    };
  };
  return [
    regimeSlice(rows, "All years · 30-day forward", oldest || "—", latest || "—"),
    byTape("Bull tape", "30-day · Bull tape months"),
    byTape("Bear tape", "30-day · Bear tape months"),
    byTape("Choppy", "30-day · Choppy months"),
    regimeSlice(rows, "2020 · crash & rebound", "2020-01-01", "2020-12-31"),
    regimeSlice(rows, "2022 · bear / rate shock", "2022-01-01", "2022-12-31"),
    regimeSlice(rows, "2023–24 · bull years", "2023-01-01", "2024-12-31"),
    regimeSlice(rows, "Last 12 months", last12From, latest || "—"),
  ];
}

/**
 * Walk-forward 1-month backtest: at each of WALK_PERIODS decision dates,
 * re-score with bars sliced point-in-time and compare to FORWARD_DAYS return.
 */
export async function runOneMonthBacktest(
  tickers: string[] = [...BACKTEST_UNIVERSE],
): Promise<BacktestReport> {
  const universe = [
    ...new Set(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean)),
  ].slice(0, 24);

  const [spyFull, vixFull, tnxFull, uupFull, hygFull] = await Promise.all([
    fetchChart("SPY", BACKTEST_RANGE),
    fetchChart("^VIX", BACKTEST_RANGE),
    fetchChart("^TNX", BACKTEST_RANGE),
    fetchChart("UUP", BACKTEST_RANGE),
    fetchChart("HYG", BACKTEST_RANGE),
  ]);

  const caches = new Map<string, TickerCache>();
  const q = [...universe];
  await Promise.all(
    Array.from({ length: Math.min(2, q.length || 1) }, async () => {
      while (q.length) {
        const t = q.shift();
        if (!t) break;
        try {
          const c = await loadLightCache(t);
          if (c) caches.set(t, c);
        } catch {
          /* skip failed ticker load */
        }
      }
    }),
  );

  for (const t of universe) {
    if (caches.has(t)) continue;
    cacheDelete(`chart:${t.toUpperCase()}:${BACKTEST_RANGE}`);
    await new Promise((r) => setTimeout(r, 700));
    try {
      const c = await loadLightCache(t);
      if (c) caches.set(t, c);
    } catch {
      /* still missing */
    }
  }

  // Use SPY bar length as calendar anchor
  const anchor = spyFull ?? [...caches.values()][0]?.bar ?? null;
  if (!anchor || anchor.closes.length < FORWARD_DAYS + 40) {
    return {
      asOf: new Date().toISOString(),
      decisionDate: "",
      evalDate: "",
      forwardDays: FORWARD_DAYS,
      walkPeriods: WALK_PERIODS,
      universe,
      rows: [],
      latestRows: [],
      periods: [],
      summary: {
        n: 0,
        nDirectional: 0,
        nIncrease: 0,
        n70: 0,
        directionalHitRate: null,
        increaseHitRate: null,
        hit70: null,
        beatSpyRate: null,
        scoreReturnCorr: null,
        avgReturnWhenIncrease: null,
        avgReturnWhenDecrease: null,
        longShortSpread: null,
        brierLike: null,
        notes: ["Not enough market history to run walk-forward backtest."],
        regimes: [],
      },
    };
  }

  const lastIdx = anchor.closes.length - 1;
  const rows: BacktestRow[] = [];
  const bannerMonths: BannerMonth[] = [];
  const peerBars = new Map<string, BarSeries>();
  if (spyFull) peerBars.set("SPY", spyFull);
  for (const [t, c] of caches) peerBars.set(t, c.bar);

  for (let period = 0; period < WALK_PERIODS; period++) {
    const decisionIdx = lastIdx - FORWARD_DAYS * (period + 1);
    const evalIdx = lastIdx - FORWARD_DAYS * period;
    if (decisionIdx < 40) break;

    const decisionDate = isoDate(anchor.timestamps[decisionIdx]!);
    const evalDate = isoDate(anchor.timestamps[evalIdx]!);
    const decisionTs = anchor.timestamps[decisionIdx]!;
    const tape = tapeAt(spyFull, vixFull, hygFull, decisionTs);
    let spyReturnMonth: number | null = null;
    if (spyFull) {
      const s0 = spyFull.closes[idxOnOrBefore(spyFull, decisionTs)];
      const s1 = spyFull.closes[idxOnOrBefore(spyFull, anchor.timestamps[evalIdx]!)];
      if (s0 && s1 && s0 > 0) spyReturnMonth = s1 / s0 - 1;
    }

    const monthRets: Array<{
      ticker: string;
      ret: number;
      rel21: number | null;
      vol63: number | null;
      isMetal: boolean;
    }> = [];

    for (const ticker of universe) {
      const cache = caches.get(ticker);
      if (!cache) {
        rows.push({
          ticker,
          name: ticker,
          period,
          decisionDate,
          evalDate,
          priceAtDecision: 0,
          priceAtEval: 0,
          actualReturn: 0,
          actualDirection: "Neutral",
          forecastDirection: "Neutral",
          forecastConfidence: 50,
          forecastScore: 0,
          abstain: true,
          hit: null,
          directionalHit: null,
          signedPnLProxy: 0,
          spyReturn: null,
          beatSpy: null,
          highConf70: false,
          error: "No price history",
        });
        continue;
      }

      // Map decision date onto this ticker's series (nearest bar at or before)
      let tDec = cache.bar.timestamps.findIndex(
        (ts, i) =>
          i < cache.bar.timestamps.length - 1 &&
          ts <= anchor.timestamps[decisionIdx]! &&
          cache.bar.timestamps[i + 1]! > anchor.timestamps[decisionIdx]!,
      );
      if (tDec < 0) {
        // last bar on or before decision
        tDec = cache.bar.timestamps.reduce(
          (best, ts, i) => (ts <= anchor.timestamps[decisionIdx]! ? i : best),
          -1,
        );
      }
      if (tDec < 40) {
        rows.push({
          ticker,
          name: cache.meta.name || ticker,
          period,
          decisionDate,
          evalDate,
          priceAtDecision: 0,
          priceAtEval: 0,
          actualReturn: 0,
          actualDirection: "Neutral",
          forecastDirection: "Neutral",
          forecastConfidence: 50,
          forecastScore: 0,
          abstain: true,
          hit: null,
          directionalHit: null,
          signedPnLProxy: 0,
          spyReturn: null,
          beatSpy: null,
          highConf70: false,
          error: "Insufficient history at decision date",
        });
        continue;
      }

      const tEval = findForwardIdx(cache.bar, tDec, FORWARD_DAYS);
      if (tEval == null) {
        rows.push({
          ticker,
          name: cache.meta.name || ticker,
          period,
          decisionDate,
          evalDate,
          priceAtDecision: cache.bar.closes[tDec]!,
          priceAtEval: 0,
          actualReturn: 0,
          actualDirection: "Neutral",
          forecastDirection: "Neutral",
          forecastConfidence: 50,
          forecastScore: 0,
          abstain: true,
          hit: null,
          directionalHit: null,
          signedPnLProxy: 0,
          spyReturn: null,
          beatSpy: null,
          highConf70: false,
          error: "No forward price",
        });
        continue;
      }

      try {
        const raw = buildRawAt(cache, tDec, spyFull, vixFull, tnxFull, uupFull, hygFull);
        const { modules, risk, snapshot } = scoreModules(raw);
        const horizons = blendTrainedOutlook(
          synthesizeHorizons(modules, risk, {
            ret21d: snapshot.ret21d,
            ret5d: snapshot.ret5d,
            ret63d: snapshot.ret63d,
            relSpy21d: snapshot.relSpy21d,
            rsi14: snapshot.rsi14,
            range52wPos: snapshot.range52wPos,
            aboveSma50: snapshot.aboveSma50,
            spyRet21d:
              snapshot.ret21d != null && snapshot.relSpy21d != null
                ? snapshot.ret21d - snapshot.relSpy21d
                : null,
            isAiHighGrowth: snapshot.isAiHighGrowth,
            tnxChg21: raw.tnx
              ? raw.tnx.closes[raw.tnx.closes.length - 1]! -
                (raw.tnx.closes[raw.tnx.closes.length - 22] ??
                  raw.tnx.closes[raw.tnx.closes.length - 1]!)
              : null,
            ticker,
            isGroupLeader: isGroupLeader(
              snapsFromBars(peerBars, cache.bar.timestamps[tDec]),
              ticker,
              snapshot.ret21d,
              snapshot.ret63d,
            ),
            isTopLeader: false,
            vixLevel: raw.vix ? raw.vix.closes[raw.vix.closes.length - 1]! : null,
            vixTrend:
              raw.vix && raw.vix.closes.length > 21
                ? raw.vix.closes[raw.vix.closes.length - 1]! /
                    raw.vix.closes[raw.vix.closes.length - 22]! -
                  1
                : null,
            hygRet21:
              raw.hyg && raw.hyg.closes.length > 21
                ? raw.hyg.closes[raw.hyg.closes.length - 1]! /
                    raw.hyg.closes[raw.hyg.closes.length - 22]! -
                  1
                : null,
          }),
          raw,
          {
            percentile: null,
            ret21d: snapshot.ret21d,
            rsi14: snapshot.rsi14,
            earnScore: modules.find((m) => m.id === "earnings")?.score ?? 0,
            fundScore: modules.find((m) => m.id === "fundamentals")?.score ?? 0,
            frictionBps: risk.estimatedRoundTripBps ?? 15,
            skipDisplayCalibrate: true,
            skipLongerHorizons: true,
          },
        );
        const h1 = horizons.find((h) => h.horizon === "1m")!;
        const p0 = cache.bar.closes[tDec]!;
        const p1 = cache.bar.closes[tEval]!;
        const actualReturn = p1 / p0 - 1;
        const actualDirection = actualDirectionFromReturn(actualReturn);
        const forecastDirection = h1.direction;
        const abstain = h1.abstain;
        let directionalHit: boolean | null = null;
        let hit: boolean | null = null;
        if (forecastDirection === "Neutral" || abstain) {
          hit = actualDirection === "Neutral";
          directionalHit = null;
        } else {
          directionalHit = forecastDirection === actualDirection;
          hit = directionalHit;
        }
        const signedPnLProxy =
          forecastDirection === "Increase"
            ? actualReturn
            : forecastDirection === "Decrease"
              ? -actualReturn
              : 0;
        let spyReturn: number | null = null;
        if (spyFull) {
          const ts0 = cache.bar.timestamps[tDec]!;
          const ts1 = cache.bar.timestamps[tEval]!;
          const s0 = spyFull.closes[idxOnOrBefore(spyFull, ts0)];
          const s1 = spyFull.closes[idxOnOrBefore(spyFull, ts1)];
          if (s0 && s1 && s0 > 0) spyReturn = s1 / s0 - 1;
        }
        const cost = 0.0015;
        const beatSpy =
          forecastDirection === "Increase" && !abstain && spyReturn != null
            ? actualReturn > spyReturn + cost
            : null;
        const highConf70 =
          forecastDirection === "Increase" && !abstain && h1.confidence >= 70;

        monthRets.push({
          ticker,
          ret: actualReturn,
          rel21: relative21(cache.bar, tDec, spyFull, cache.bar.timestamps[tDec]!),
          vol63: vol63At(cache.bar, tDec),
          isMetal: quantGroup(ticker, cache.meta.industry) === "metals",
        });

        rows.push({
          ticker,
          name: cache.meta.name || raw.bar.name || ticker,
          period,
          decisionDate,
          evalDate: isoDate(cache.bar.timestamps[tEval]!),
          priceAtDecision: p0,
          priceAtEval: p1,
          actualReturn,
          actualDirection,
          forecastDirection,
          forecastConfidence: h1.confidence,
          forecastScore: h1.score,
          abstain,
          hit,
          directionalHit,
          signedPnLProxy,
          spyReturn,
          beatSpy,
          highConf70,
        });
      } catch (e) {
        rows.push({
          ticker,
          name: cache.meta.name || ticker,
          period,
          decisionDate,
          evalDate,
          priceAtDecision: cache.bar.closes[tDec] ?? 0,
          priceAtEval: 0,
          actualReturn: 0,
          actualDirection: "Neutral",
          forecastDirection: "Neutral",
          forecastConfidence: 50,
          forecastScore: 0,
          abstain: true,
          hit: null,
          directionalHit: null,
          signedPnLProxy: 0,
          spyReturn: null,
          beatSpy: null,
          highConf70: false,
          error: e instanceof Error ? e.message : "Backtest row failed",
        });
      }
    }

    const { hold, brk } = pickHoldUps(monthRets);
    bannerMonths.push({
      decisionDate,
      evalDate,
      tape: tape.label,
      reasons: tape.reasons,
      flipBack: tape.flipBack,
      suppressRiseCalls: tape.suppressRiseCalls,
      spyReturn: spyReturnMonth,
      spyNegative: spyReturnMonth != null ? spyReturnMonth < -0.005 : false,
      holdUpReturn: meanRet(hold.map((x) => x.ret)),
      breakDownReturn: meanRet(brk.map((x) => x.ret)),
      nHoldUp: hold.length,
      nBreakDown: brk.length,
      holdUpNames: hold.map((x) => x.ticker),
      breakDownNames: brk.map((x) => x.ticker),
      ifWeHadCalledRise: meanRet(monthRets.map((x) => x.ret)),
    });
  }

  const periods: PeriodSummary[] = [];
  for (let p = 0; p < WALK_PERIODS; p++) {
    const pr = rows.filter((r) => r.period === p && !r.error);
    if (!pr.length) continue;
    periods.push(periodSummary(p, pr));
  }

  const allOk = rows.filter((r) => !r.error);
  const tapeByDate = new Map(bannerMonths.map((m) => [m.decisionDate, m]));
  for (const r of rows) {
    const bm = tapeByDate.get(r.decisionDate);
    if (bm) r.tape = bm.tape;
  }
  applyWalkForwardCalibration(allOk);
  const base = summarizeRows(allOk);
  const regimes = buildRegimes(allOk);
  const banner = buildBannerTest(bannerMonths);
  for (const p of periods) {
    const bm = tapeByDate.get(p.decisionDate);
    if (bm) {
      p.tape = bm.tape;
      p.spyReturn = bm.spyReturn;
    }
  }
  const notes: string[] = [
    `Walk-forward: ${periods.length || WALK_PERIODS} × ~${FORWARD_DAYS} trading-day windows on ${universe.length} names, using ${BACKTEST_RANGE} of prices.`,
    "Accuracy uses only prices that were knowable on that date. Live headlines are not counted as if we had them in 2020 or 2022.",
    "1-month rise needs the market up, fear not high or rising, junk bonds not sliding, a group leader that is beating the market, a US listing vs this tape, and an expected move bigger than costs.",
    ...banner.notes,
  ];
  if (base.n70) {
    notes.push(
      `When confidence was 70%+ on a rise call: ${base.hit70 != null ? `${(base.hit70 * 100).toFixed(0)}%` : "—"} rose (${base.n70} calls).`,
    );
  } else {
    notes.push("No 70%+ rise calls in this window — the bar is high on purpose.");
  }
  if (base.beatSpyRate != null) {
    notes.push(
      `Rise calls that beat SPY after ~15 bps cost: ${(base.beatSpyRate * 100).toFixed(0)}%.`,
    );
  }
  for (const rg of regimes) {
    if (rg.nIncrease) {
      notes.push(
        `${rg.label}: ${rg.increaseHitRate != null ? `${(rg.increaseHitRate * 100).toFixed(0)}%` : "—"} of ${rg.nIncrease} rise calls were up a month later.`,
      );
    } else {
      notes.push(`${rg.label}: no rise calls (it sat out).`);
    }
  }

  const latestRows = rows.filter((r) => r.period === 0);
  const latestDec = latestRows[0]?.decisionDate ?? "";
  const latestEval = latestRows[0]?.evalDate ?? "";

  return {
    asOf: new Date().toISOString(),
    decisionDate: latestDec,
    evalDate: latestEval,
    forwardDays: FORWARD_DAYS,
    walkPeriods: periods.length || WALK_PERIODS,
    universe,
    rows,
    latestRows,
    periods,
    summary: {
      ...base,
      brierLike: null,
      notes,
      regimes,
      banner,
    },
  };
}

const EMPTY_FUND = {
  marketCap: null,
  peApprox: null,
  pbApprox: null,
  roe: null,
  revGrowthYoy: null,
  niGrowthYoy: null,
  shares: null,
  ni: null,
  ocf: null,
  rdExpense: null,
  capex: null,
  dividendYield: null,
  debtEquity: null,
  profitMargin: null,
  notes: ["Light backtest — price/macro only"],
};

const EMPTY_SENT = { newsCount: 0, sentimentScore: 0, headlines: [] as string[], asOf: "" };
const EMPTY_GOV = {
  form4Count90d: null as number | null,
  form4Count180d: null as number | null,
  insiderSignal: 0,
  notes: [] as string[],
};

async function loadLightCache(ticker: string): Promise<TickerCache | null> {
  let bar = await fetchChart(ticker, BACKTEST_RANGE);
  if (!bar || bar.closes.length < 80) {
    cacheDelete(`chart:${ticker.toUpperCase()}:${BACKTEST_RANGE}`);
    await new Promise((r) => setTimeout(r, 700));
    bar = await fetchChart(ticker, BACKTEST_RANGE);
  }
  if (!bar || bar.closes.length < 80) return null;
  return {
    bar,
    meta: {
      name: TICKER_PROFILE[ticker]?.name || bar.name || ticker,
      sector: null,
      industry: TICKER_PROFILE[ticker]?.industry || null,
    },
    fundamentals: EMPTY_FUND,
    sentiment: EMPTY_SENT,
    social: emptySocialBundle(),
    governance: EMPTY_GOV,
    quality: buildQualityFromFund(EMPTY_FUND),
  };
}

type CallSlice = {
  dir: Direction;
  abstain: boolean;
  conf: number;
  actual: number;
  spy: number | null;
};

function sliceStats(rows: CallSlice[]) {
  const dir = rows.filter((r) => r.dir !== "Neutral" && !r.abstain);
  const hits = dir.filter((r) =>
    r.dir === "Increase" ? r.actual > 0.005 : r.actual < -0.005,
  );
  const inc = rows.filter((r) => r.dir === "Increase" && !r.abstain);
  const incHits = inc.filter((r) => r.actual > 0.005);
  const hi = inc.filter((r) => r.conf >= 70);
  const hiHits = hi.filter((r) => r.actual > 0.005);
  const beat = inc.filter((r) => r.spy != null && r.actual > r.spy + 0.0015);
  const avgInc =
    inc.length > 0 ? inc.reduce((a, b) => a + b.actual, 0) / inc.length : null;
  return {
    n: rows.length,
    nDirectional: dir.length,
    nIncrease: inc.length,
    n70: hi.length,
    directionalHitRate: dir.length ? hits.length / dir.length : null,
    increaseHitRate: inc.length ? incHits.length / inc.length : null,
    hit70: hi.length ? hiHits.length / hi.length : null,
    beatSpyRate: inc.length ? beat.length / inc.length : null,
    avgReturnWhenIncrease: avgInc,
  };
}

export interface ComparisonReport {
  asOf: string;
  walkPeriods: number;
  universeSize: number;
  loaded: number;
  n: number;
  original: ReturnType<typeof sliceStats>;
  trained: ReturnType<typeof sliceStats>;
  alwaysLong: ReturnType<typeof sliceStats>;
}

/** Larger PIT sample: rules-only vs history-trained, same dates and names. */
export async function runLargeComparison(opts?: {
  tickers?: string[];
  periods?: number;
  maxTickers?: number;
}): Promise<ComparisonReport> {
  const periods = opts?.periods ?? 18;
  const maxTickers = opts?.maxTickers ?? 64;
  const universe = [
    ...new Set(
      (opts?.tickers ?? [...LISTED_STOCKS, ...SCAN_UNIVERSE]).map((t) =>
        t.toUpperCase().trim(),
      ),
    ),
  ].slice(0, maxTickers);

  const [spyFull, vixFull, tnxFull, uupFull, hygFull] = await Promise.all([
    fetchChart("SPY", "2y"),
    fetchChart("^VIX", "2y"),
    fetchChart("^TNX", "2y"),
    fetchChart("UUP", "2y"),
    fetchChart("HYG", "2y"),
  ]);

  const caches = new Map<string, TickerCache>();
  const q = [...universe];
  await Promise.all(
    Array.from({ length: Math.min(5, q.length || 1) }, async () => {
      while (q.length) {
        const t = q.shift();
        if (!t) break;
        try {
          const c = await loadLightCache(t);
          if (c) caches.set(t, c);
        } catch {
          /* skip */
        }
      }
    }),
  );

  const anchor = spyFull ?? [...caches.values()][0]?.bar ?? null;
  const original: CallSlice[] = [];
  const trained: CallSlice[] = [];
  const alwaysLong: CallSlice[] = [];

  if (!anchor || anchor.closes.length < FORWARD_DAYS + 80) {
    return {
      asOf: new Date().toISOString(),
      walkPeriods: 0,
      universeSize: universe.length,
      loaded: caches.size,
      n: 0,
      original: sliceStats([]),
      trained: sliceStats([]),
      alwaysLong: sliceStats([]),
    };
  }

  const lastIdx = anchor.closes.length - 1;
  const peerBars = new Map<string, BarSeries>();
  if (spyFull) peerBars.set("SPY", spyFull);
  for (const [t, c] of caches) peerBars.set(t, c.bar);
  for (let period = 0; period < periods; period++) {
    const decisionIdx = lastIdx - FORWARD_DAYS * (period + 1);
    if (decisionIdx < 80) break;
    const decisionTs = anchor.timestamps[decisionIdx]!;

    for (const ticker of universe) {
      const cache = caches.get(ticker);
      if (!cache) continue;
      const tDec = idxOnOrBefore(cache.bar, decisionTs);
      if (tDec < 80) continue;
      const tEval = findForwardIdx(cache.bar, tDec, FORWARD_DAYS);
      if (tEval == null) continue;
      const p0 = cache.bar.closes[tDec]!;
      const p1 = cache.bar.closes[tEval]!;
      if (!(p0 > 0) || !(p1 > 0)) continue;
      const actual = p1 / p0 - 1;
      let spyRet: number | null = null;
      if (spyFull) {
        const s0 = spyFull.closes[idxOnOrBefore(spyFull, cache.bar.timestamps[tDec]!)];
        const s1 = spyFull.closes[idxOnOrBefore(spyFull, cache.bar.timestamps[tEval]!)];
        if (s0 && s1 && s0 > 0) spyRet = s1 / s0 - 1;
      }
      try {
        const raw = buildRawAt(cache, tDec, spyFull, vixFull, tnxFull, uupFull, hygFull);
        const { modules, risk, snapshot } = scoreModules(raw);
        const snapCtx = {
          ret21d: snapshot.ret21d,
          ret5d: snapshot.ret5d,
          ret63d: snapshot.ret63d,
          relSpy21d: snapshot.relSpy21d,
          rsi14: snapshot.rsi14,
          range52wPos: snapshot.range52wPos,
          aboveSma50: snapshot.aboveSma50,
          spyRet21d:
            snapshot.ret21d != null && snapshot.relSpy21d != null
              ? snapshot.ret21d - snapshot.relSpy21d
              : null,
          isAiHighGrowth: snapshot.isAiHighGrowth,
          tnxChg21: raw.tnx
            ? raw.tnx.closes[raw.tnx.closes.length - 1]! -
              (raw.tnx.closes[raw.tnx.closes.length - 22] ??
                raw.tnx.closes[raw.tnx.closes.length - 1]!)
            : null,
        };
        const peers = snapsFromBars(peerBars, cache.bar.timestamps[tDec]);
        Object.assign(snapCtx, {
          ticker,
          isGroupLeader: isGroupLeader(peers, ticker, snapshot.ret21d, snapshot.ret63d),
          isTopLeader: false,
          vixLevel: raw.vix ? raw.vix.closes[raw.vix.closes.length - 1]! : null,
          vixTrend:
            raw.vix && raw.vix.closes.length > 21
              ? raw.vix.closes[raw.vix.closes.length - 1]! /
                  raw.vix.closes[raw.vix.closes.length - 22]! -
                1
              : null,
          hygRet21:
            raw.hyg && raw.hyg.closes.length > 21
              ? raw.hyg.closes[raw.hyg.closes.length - 1]! /
                  raw.hyg.closes[raw.hyg.closes.length - 22]! -
                1
              : null,
        });
        const rulesH = synthesizeHorizons(modules, risk, snapCtx).find((h) => h.horizon === "1m")!;
        const trainedH = blendTrainedOutlook(
          synthesizeHorizons(modules, risk, snapCtx),
          raw,
          {
            percentile: null,
            ret21d: snapshot.ret21d,
            rsi14: snapshot.rsi14,
            earnScore: modules.find((m) => m.id === "earnings")?.score ?? 0,
            fundScore: modules.find((m) => m.id === "fundamentals")?.score ?? 0,
            frictionBps: risk.estimatedRoundTripBps ?? 15,
            skipDisplayCalibrate: true,
            skipLongerHorizons: true,
          },
        ).find((h) => h.horizon === "1m")!;

        original.push({
          dir: rulesH.direction,
          abstain: rulesH.abstain,
          conf: rulesH.confidence,
          actual,
          spy: spyRet,
        });
        trained.push({
          dir: trainedH.direction,
          abstain: trainedH.abstain,
          conf: trainedH.confidence,
          actual,
          spy: spyRet,
        });
        alwaysLong.push({
          dir: "Increase",
          abstain: false,
          conf: 50,
          actual,
          spy: spyRet,
        });
      } catch {
        /* skip broken row */
      }
    }
  }

  return {
    asOf: new Date().toISOString(),
    walkPeriods: periods,
    universeSize: universe.length,
    loaded: caches.size,
    n: trained.length,
    original: sliceStats(original),
    trained: sliceStats(trained),
    alwaysLong: sliceStats(alwaysLong),
  };
}

