import { clamp, formatPct, formatUsd, round } from "@/lib/utils";
import {
  buildSnapshot,
  estimateFrictionBps,
  fetchRawBundle,
  getSeriesHelpers,
  prefetchMacro,
  type BarSeries,
  type RawBundle,
} from "./market-data";
import { livePeerSnaps, isGroupLeader, isForeignListing, isLeveredEtf, peerPercentile } from "./peer-tape";
import { trainOutlook } from "./predict";
import { attachQuantRanks, rawQuantFactors } from "./quant";
import { compareLikelyRise, quantGroup, TICKER_PROFILE, displayTicker } from "./listed";
import { classifyTape, tapeInputsFromBars } from "./tape-regime";
import { attachWhy, highConfidenceNotes, spellOutDrivers } from "@/lib/plain-language";
import { scoreBand, tanhScore } from "./indicators";
import type {
  AnalysisReport,
  Direction,
  Horizon,
  HorizonForecast,
  ModuleScore,
  RiskView,
  TickerAnalysis,
} from "./types";

export const DISCLAIMER =
  "This is an approximation of a research framework for educational and decision-support purposes only. It is not financial, investment, or trading advice. Markets are noisy; most directional forecasts at these horizons have limited real-world edge after costs, slippage, and regime changes. Past patterns do not guarantee future results. Always do your own due diligence and consider position sizing, risk limits, and professional advice. The confidence percentages reflect the model’s internal assessment of evidence strength, not a guaranteed statistical frequency.";

const HORIZON_WEIGHTS: Record<
  Horizon,
  { modules: Record<string, number>; label: string; dirThreshold: number }
> = {
  "1m": {
    label: "1-Month",
    dirThreshold: 0.24,
    modules: {
      reversal: 0.16,
      momentum: 0.2,
      psychology: 0.11,
      calendar: 0.08,
      competitors: 0.06,
      macro: 0.1,
      positioning: 0.07,
      social: 0.05,
      money: 0.04,
      sentiment: 0.03,
      political: 0.04,
      earnings: 0.03,
      governance: 0.03,
      industry: 0.0,
      fundamentals: 0,
      valuation: 0,
      lowVol: 0,
      otherFactors: 0,
    },
  },
  "3m": {
    label: "3-Month",
    dirThreshold: 0.16,
    modules: {
      reversal: 0.04,
      momentum: 0.13,
      psychology: 0.04,
      calendar: 0.04,
      competitors: 0.07,
      social: 0.03,
      money: 0.04,
      sentiment: 0.03,
      political: 0.06,
      positioning: 0.06,
      macro: 0.09,
      earnings: 0.12,
      governance: 0.05,
      industry: 0.06,
      fundamentals: 0.07,
      valuation: 0.05,
      lowVol: 0.06,
      otherFactors: 0.04,
    },
  },
  "6m": {
    label: "6-Month",
    dirThreshold: 0.14,
    modules: {
      reversal: 0.02,
      momentum: 0.08,
      psychology: 0.02,
      calendar: 0.03,
      competitors: 0.06,
      social: 0.02,
      money: 0.03,
      sentiment: 0.02,
      political: 0.06,
      positioning: 0.03,
      macro: 0.07,
      earnings: 0.11,
      governance: 0.07,
      industry: 0.08,
      fundamentals: 0.12,
      valuation: 0.1,
      lowVol: 0.08,
      otherFactors: 0.05,
    },
  },
};

function directionFromScore(score: number, threshold: number): Direction {
  if (score >= threshold) return "Increase";
  if (score <= -threshold) return "Decrease";
  return "Neutral";
}

function calibrateConfidence(raw: number, evidence: number): number {
  const shrunk = 50 + (raw - 50) * 0.72 * clamp(evidence, 0.35, 1);
  return clamp(Math.round(shrunk), 42, 72);
}

function finalConfidence(opts: {
  horizon: Horizon;
  direction: Direction;
  abstain: boolean;
  score: number;
  rawCalibrated: number;
}): number {
  const { horizon, direction, abstain, score, rawCalibrated } = opts;
  if (abstain || direction === "Neutral") {
    return Math.min(rawCalibrated, 58);
  }
  if (horizon === "1m") {
    const fromScore = Math.round(48 + Math.abs(score) * 32);
    return clamp(Math.max(rawCalibrated, fromScore), 42, 80);
  }
  if (Math.abs(score) >= 0.35) {
    const fromScore = Math.round(50 + Math.abs(score) * 28);
    return clamp(Math.max(rawCalibrated, fromScore), 42, 76);
  }
  return rawCalibrated;
}

type ConfirmCtx = {
  ret21d: number | null;
  ret5d: number | null;
  ret63d: number | null;
  relSpy21d: number | null;
  rsi14: number | null;
  range52wPos: number | null;
  aboveSma50: boolean | null;
  spyRet21d: number | null;
  isAiHighGrowth?: boolean;
  tnxChg21?: number | null;
  isTopLeader?: boolean;
  isGroupLeader?: boolean;
  ticker?: string;
  vixLevel?: number | null;
  vixTrend?: number | null;
  hygRet21?: number | null;
};

/**
 * 1M rise: market up, fear not elevated, name leading its own group,
 * not a foreign listing vs this tape, not already stretched, beating SPY.
 */
function oneMonthConfirmation(
  mom: number,
  _rev: number,
  blended: number,
  ctx?: ConfirmCtx,
): { score: number; note: string } {
  const spy21 = ctx?.spyRet21d;
  const ret63 = ctx?.ret63d;
  const ret21 = ctx?.ret21d;
  const vix = ctx?.vixLevel;

  if (ctx?.ticker && isForeignListing(ctx.ticker)) {
    return {
      score: blended * 0.08,
      note: "1M muted: non-US listing — different close than this tape",
    };
  }
  if (spy21 != null && spy21 <= 0) {
    return { score: blended * 0.08, note: "1M muted: overall market is not up this month" };
  }
  if (vix != null && vix >= 20) {
    return { score: blended * 0.08, note: "1M muted: market fear (VIX) is too high" };
  }
  if (ctx?.vixTrend != null && ctx.vixTrend > 0.12) {
    return { score: blended * 0.08, note: "1M muted: fear is rising even if VIX is not high yet" };
  }
  if (ctx?.hygRet21 != null && ctx.hygRet21 < -0.02) {
    return { score: blended * 0.08, note: "1M muted: junk bonds are sliding — tape is breaking" };
  }
  if ((ret63 ?? 0) <= 0) {
    return { score: blended * 0.08, note: "1M muted: 3-month trend is not up" };
  }
  if (ctx?.relSpy21d != null && ctx.relSpy21d < 0) {
    return { score: blended * 0.08, note: "1M muted: lagging the market this month" };
  }
  if (ctx?.isAiHighGrowth && (ctx.tnxChg21 ?? 0) > 0.25) {
    return { score: blended * 0.08, note: "1M blocked: yields jumped — growth under pressure" };
  }
  const leader = ctx?.isGroupLeader === true || ctx?.isTopLeader === true;
  if (leader && (ret21 ?? 0) > 0) {
    const s = clamp(0.34 + 0.4 * Math.max(0, mom), -1, 1);
    return {
      score: s,
      note: "1M leader: strong in its own group this month while the market is up",
    };
  }
  return { score: blended * 0.08, note: "1M muted: not among the strongest names this month" };
}

export function scoreModules(raw: RawBundle): {
  modules: ModuleScore[];
  risk: RiskView;
  snapshot: ReturnType<typeof buildSnapshot>;
} {
  const snap = buildSnapshot(raw.bar.symbol, raw);
  const h = getSeriesHelpers(raw);
  const frictionBps = estimateFrictionBps(h.avgDollarVol);
  const commodity = snap.isCommodityLike;

  const revNotes: string[] = [];
  let rev = 0;
  if (commodity) {
    if (snap.ret5d != null) {
      rev += -0.1 * tanhScore(snap.ret5d, 0.05);
      revNotes.push(`Commodity mild 5d ${formatPct(snap.ret5d)}`);
    }
  } else {
    if (snap.ret5d != null) {
      rev += -0.38 * tanhScore(snap.ret5d, 0.035);
      revNotes.push(`5d fade ${formatPct(snap.ret5d)}`);
    }
    if (snap.ret21d != null) {
      rev += -0.28 * tanhScore(snap.ret21d, 0.09);
      revNotes.push(`21d stretch ${formatPct(snap.ret21d)}`);
    }
    if (snap.relSpy21d != null) {
      rev += -0.15 * tanhScore(snap.relSpy21d, 0.06);
    }
  }
  if (snap.rsi14 != null) {
    if (snap.rsi14 > 70) {
      rev -= 0.28;
      revNotes.push(`RSI ${snap.rsi14.toFixed(0)} overbought`);
    } else if (snap.rsi14 < 35) {
      rev += 0.25;
      revNotes.push(`RSI ${snap.rsi14.toFixed(0)} oversold`);
    } else if (snap.rsi14 >= 40 && snap.rsi14 <= 60) {
      rev += 0.05;
      revNotes.push(`RSI ${snap.rsi14.toFixed(0)} neutral zone`);
    } else {
      revNotes.push(`RSI ${snap.rsi14.toFixed(0)}`);
    }
  }
  if ((snap.range52wPos ?? 0) > 0.88 && (snap.rsi14 ?? 50) > 62) {
    rev -= 0.22;
    revNotes.push("Crowded 52w high");
  }
  if ((snap.range52wPos ?? 1) < 0.12 && (snap.rsi14 ?? 50) < 40) {
    rev += 0.15;
    revNotes.push("Washed-out 52w low");
  }
  if (h.vol21 != null && h.vol21 > 0.5 && snap.ret5d != null && Math.abs(snap.ret5d) > 0.04) {
    rev -= 0.1 * Math.sign(snap.ret5d);
    revNotes.push("Vol spike fade");
  }
  rev = clamp(rev, -1, 1);
  const revConf = clamp(0.4 + Math.abs(rev) * 0.28, 0.35, 0.72);

  const momNotes: string[] = [];
  let mom = 0;
  if (snap.ret21d != null && snap.ret63d != null) {
    const spread = snap.ret21d - snap.ret63d;
    mom += 0.55 * tanhScore(spread, 0.06);
    momNotes.push(`20d ${formatPct(snap.ret21d)} minus 60d ${formatPct(snap.ret63d)}`);
  }
  if (snap.ret63d != null) {
    mom += 0.25 * tanhScore(snap.ret63d, 0.12);
  }
  if (snap.relSpy63d != null) {
    mom += 0.15 * tanhScore(snap.relSpy63d, 0.08);
    momNotes.push(`63d vs market ${formatPct(snap.relSpy63d)}`);
  }
  if (snap.aboveSma200 != null) {
    mom += snap.aboveSma200 ? 0.1 : -0.1;
    momNotes.push(snap.aboveSma200 ? "Above 200-day average" : "Below 200-day average");
  }
  mom = clamp(mom, -1, 1);
  const momConf = clamp(0.42 + Math.abs(mom) * 0.28, 0.35, 0.78);

  const sentNotes: string[] = [];
  let sent = 0;
  let sentConf = 0.25;
  if (snap.sentiment && snap.sentiment.newsCount > 0) {
    sent = clamp(snap.sentiment.sentimentScore * 0.55, -1, 1);
    sentConf = clamp(0.25 + Math.min(snap.sentiment.newsCount, 10) * 0.025, 0.22, 0.55);
    sentNotes.push(`${snap.sentiment.newsCount} headlines · damped ${sent.toFixed(2)}`);
    if (snap.sentiment.headlines[0]) {
      sentNotes.push(`e.g. “${snap.sentiment.headlines[0].slice(0, 72)}”`);
    }
  } else sentNotes.push("No usable headline sample");

  const socNotes: string[] = [];
  let social = 0;
  let socialConf = 0.18;
  if (snap.social) {
    const st = snap.social.stocktwits;
    const rd = snap.social.reddit;
    const x = snap.social.x;
    const parts = [
      { s: st.score, n: st.sampleCount, w: 0.45 },
      { s: rd.score, n: rd.sampleCount, w: 0.2 },
      { s: x?.score ?? 0, n: x?.sampleCount ?? 0, w: 0.35 },
    ].filter((p) => p.n > 0);
    const tw = parts.reduce((a, p) => a + p.w, 0);
    if (tw > 0) {
      social = clamp(parts.reduce((a, p) => a + p.s * p.w, 0) / tw * 0.5, -1, 1);
      socialConf = 0.24;
    }
    socNotes.push(`ST ${st.bullish}↑/${st.bearish}↓ n=${st.sampleCount}`);
    socNotes.push(`X n=${x?.sampleCount ?? 0} · Reddit n=${rd.sampleCount}`);
  } else socNotes.push("Social unavailable");

  const moneyNotes: string[] = [];
  let money = 0;
  let moneyConf = 0.18;
  if (snap.social?.money && snap.social.money.sampleCount > 0) {
    money = clamp(snap.social.money.score * 0.7, -1, 1);
    moneyConf = clamp(0.22 + Math.min(snap.social.money.sampleCount, 10) * 0.03, 0.2, 0.6);
    moneyNotes.push(...snap.social.money.notes.slice(0, 2));
    if (snap.social.money.samples[0]) {
      moneyNotes.push(`e.g. “${snap.social.money.samples[0].slice(0, 80)}”`);
    }
  } else moneyNotes.push("No BlackRock / Blackstone / key-person headlines");

  const psychNotes: string[] = [];
  let psych = 0;
  if (h.vixLevel != null) {
    if (h.vixLevel >= 22) {
      psych -= 0.35;
      psychNotes.push(`Fear: VIX ${h.vixLevel.toFixed(1)}`);
    } else if (h.vixLevel <= 13) {
      psych -= 0.12;
      psychNotes.push(`Complacency: VIX ${h.vixLevel.toFixed(1)}`);
    } else psychNotes.push(`VIX ${h.vixLevel.toFixed(1)} (normal fear range)`);
  }
  if (snap.rsi14 != null && snap.rsi14 > 72 && (snap.range52wPos ?? 0) > 0.9) {
    psych -= 0.28;
    psychNotes.push("Crowded: stretched and near a 52-week high");
  } else if (snap.rsi14 != null && snap.rsi14 < 32) {
    psych += 0.22;
    psychNotes.push("Washout: weak short-term psychology");
  }
  if (snap.volumeZ20 != null && snap.ret5d != null && snap.volumeZ20 > 1.6) {
    psych -= 0.15 * Math.sign(snap.ret5d);
    psychNotes.push("Heavy volume chase/panic");
  }
  if (h.hygRet21 != null && h.hygRet21 < -0.02) {
    psych -= 0.12;
    psychNotes.push("Credit markets uneasy (junk bonds down)");
  }
  psych = clamp(psych, -1, 1);
  const psychConf = 0.55;

  const calNotes: string[] = [...(snap.calendarNotes ?? [])];
  let cal = 0;
  let calConf = 0.35;
  const nearEarn = snap.daysToEarnings != null && snap.daysToEarnings >= 0 && snap.daysToEarnings <= 7;
  const nearFed = snap.daysToFed != null && snap.daysToFed >= 0 && snap.daysToFed <= 5;
  const nearCpi = snap.daysToCpi != null && snap.daysToCpi >= 0 && snap.daysToCpi <= 3;
  if (nearEarn || nearFed || nearCpi) {
    cal = 0;
    calConf = 0.72;
    calNotes.push("Binary event soon — 1-month call is pulled toward “wait and see”");
  } else if (snap.daysToEarnings != null && snap.daysToEarnings < 0 && snap.daysToEarnings >= -4) {
    calNotes.push("Just reported — news/chatter matter more this week");
    calConf = 0.45;
  }
  if (snap.nextEvent) calNotes.unshift(`Next: ${snap.nextEvent}`);

  const compNotes: string[] = [...(snap.competitorNotes ?? [])];
  let comp = 0;
  let compConf = 0.25;
  if (snap.competitorRel21 != null) {
    comp = clamp(tanhScore(snap.competitorRel21, 0.04), -1, 1);
    compConf = 0.5;
    if (snap.competitorRel21 > 0.03) {
      compNotes.push("Money has been favoring this name vs close rivals");
    } else if (snap.competitorRel21 < -0.03) {
      compNotes.push("Rivals have been taking the flows this month");
    }
  }

  const lvNotes: string[] = [];
  let lvScore = 0;
  if (h.vol63 != null) {
    lvScore += 0.55 * tanhScore(0.25 - h.vol63, 0.12);
    lvNotes.push(`63-day vol ${(h.vol63 * 100).toFixed(0)}% — calmer scores higher`);
  }
  if (h.betaSpy != null) {
    lvScore += 0.45 * tanhScore(1 - h.betaSpy, 0.45);
    lvNotes.push(`Beta ${h.betaSpy.toFixed(2)} vs the market`);
  }
  lvScore = clamp(lvScore, -1, 1);
  const lvConf = 0.55;

  const otherNotes: string[] = [];
  let otherScore = 0;
  let otherN = 0;
  if (snap.niGrowthYoy != null) {
    otherScore += tanhScore(snap.niGrowthYoy, 0.22);
    otherN++;
    otherNotes.push(`Earnings growth ${formatPct(snap.niGrowthYoy)}`);
  }
  if (snap.dividendYield != null && snap.dividendYield > 0) {
    otherScore += tanhScore(snap.dividendYield, 0.03);
    otherN++;
    otherNotes.push(`Dividend ${formatPct(snap.dividendYield)}`);
  }
  if (snap.governance?.insiderSignal) {
    otherScore += snap.governance.insiderSignal;
    otherN++;
    otherNotes.push("Insider filings included");
  }
  if (h.avgDollarVol != null) {
    otherScore += h.avgDollarVol > 20_000_000 ? 0.1 : h.avgDollarVol < 5_000_000 ? -0.2 : 0;
    otherN++;
  }
  otherScore = otherN ? clamp(otherScore / otherN, -1, 1) : 0;
  const otherConf = otherN ? 0.4 : 0.2;

  const polNotes: string[] = [];
  let political = 0;
  let politicalConf = 0.2;
  if (snap.social?.political) {
    const p = snap.social.political;
    political = clamp(p.score * 0.8, -1, 1);
    politicalConf = clamp(0.22 + Math.min(p.sampleCount, 12) * 0.02, 0.2, 0.6);
    polNotes.push(...p.notes.slice(0, 2));
    if (p.samples[0]) polNotes.push(`e.g. “${p.samples[0].slice(0, 80)}”`);
  } else polNotes.push("Political feed unavailable");

  const posNotes: string[] = [];
  let pos = 0;
  if (snap.volumeZ20 != null && snap.ret5d != null) {
    if (Math.abs(snap.volumeZ20) > 1.3 && Math.abs(snap.ret5d) > 0.03) {
      pos -= 0.22 * Math.sign(snap.ret5d);
      posNotes.push(`Exhaustion vol z${snap.volumeZ20.toFixed(2)}`);
    } else posNotes.push(`Volume z20 ${snap.volumeZ20.toFixed(2)}`);
  }
  if (snap.range52wPos != null) {
    pos += 0.1 * tanhScore(0.55 - snap.range52wPos, 0.35);
  }
  if (h.avgDollarVol != null) {
    posNotes.push(`~${formatUsd(h.avgDollarVol, true)}/day · ~${frictionBps} bps RT`);
    if (h.avgDollarVol < 5_000_000) pos -= 0.15;
  }
  pos = clamp(pos, -1, 1);
  const posConf = clamp(0.32 + Math.abs(pos) * 0.25, 0.28, 0.62);

  const earnNotes: string[] = [];
  let earn = 0;
  let earnConf = 0.25;
  if (snap.revGrowthYoy != null) {
    earn += 0.42 * tanhScore(snap.revGrowthYoy, 0.15);
    earnNotes.push(`Rev YoY ${formatPct(snap.revGrowthYoy)}`);
    earnConf += 0.2;
  } else earnNotes.push("Rev YoY unavailable");
  if (snap.niGrowthYoy != null) {
    earn += 0.38 * tanhScore(snap.niGrowthYoy, 0.25);
    earnNotes.push(`NI YoY ${formatPct(snap.niGrowthYoy)}`);
    earnConf += 0.18;
  }
  if (snap.quality?.accrualsProxy != null && snap.quality.accrualsProxy > 0.4) {
    earn -= 0.15;
    earnNotes.push("Accruals drag");
    earnConf *= 0.85;
  }
  earn = clamp(earn, -1, 1);
  earnConf = clamp(earnConf, 0.2, 0.75);

  const fundNotes: string[] = [];
  let fund = 0;
  let fundConf = 0.25;
  if (snap.roe != null) {
    fund += 0.4 * scoreBand(snap.roe, { low: 0.05, high: 0.25 });
    fundNotes.push(`ROE ${(snap.roe * 100).toFixed(1)}%`);
    fundConf += 0.18;
  }
  if (snap.revGrowthYoy != null) fund += 0.2 * tanhScore(snap.revGrowthYoy, 0.2);
  if (snap.niGrowthYoy != null) fund += 0.15 * tanhScore(snap.niGrowthYoy, 0.3);
  if (snap.quality?.accrualsProxy != null) {
    fund += 0.2 * tanhScore(-snap.quality.accrualsProxy, 0.6);
    fundNotes.push(...snap.quality.notes.slice(0, 1));
    fundConf += 0.1;
  }
  if (snap.profitMargin != null) {
    fund += 0.15 * tanhScore(snap.profitMargin, 0.12);
    fundNotes.push(`Profit margin ${formatPct(snap.profitMargin)}`);
  }
  if (snap.debtEquity != null) {
    fund += 0.15 * tanhScore(0.8 - snap.debtEquity, 0.8);
    fundNotes.push(`Debt/equity ${snap.debtEquity.toFixed(2)}`);
  }
  if (snap.niGrowthYoy != null && snap.niGrowthYoy < -0.3) {
    fund -= 0.2;
    fundNotes.push("Material NI contraction");
  }
  if (snap.marketCap != null) {
    fundNotes.push(`Mkt cap ~${formatUsd(snap.marketCap, true)}`);
    fundConf += 0.08;
  }
  if (snap.isAiHighGrowth) {
    fundNotes.push("AI stack risk checklist applied");
    if ((snap.revGrowthYoy ?? 0) < 0.08 && (snap.peApprox ?? 0) > 40) {
      fund -= 0.12;
      fundNotes.push("AI multiple without growth — haircut");
    }
  }
  if (!fundNotes.length) fundNotes.push("Sparse fundamentals");
  fund = clamp(fund, -1, 1);
  fundConf = clamp(fundConf, 0.2, 0.78);

  const valNotes: string[] = [];
  let val = 0;
  let valConf = 0.25;
  if (snap.peApprox != null && snap.peApprox > 0) {
    val += 0.45 * scoreBand(snap.peApprox, { low: 12, high: 40 }, true);
    valNotes.push(`P/E ~${snap.peApprox.toFixed(1)}`);
    valConf += 0.2;
    if (snap.peApprox > 45 && (snap.revGrowthYoy ?? 0) < 0.12) {
      val -= 0.2;
      valNotes.push("Elevated multiple w/o growth");
    }
  } else valNotes.push("P/E unavailable");
  if (snap.pbApprox != null && snap.pbApprox > 0) {
    val += 0.22 * scoreBand(snap.pbApprox, { low: 1.5, high: 12 }, true);
    valNotes.push(`P/B ~${snap.pbApprox.toFixed(1)}`);
    valConf += 0.1;
  }
  val = clamp(val, -1, 1);
  valConf = clamp(valConf, 0.2, 0.72);

  const macroNotes: string[] = [];
  let macro = 0;
  if (h.spyTrend63 != null) {
    macro += 0.42 * tanhScore(h.spyTrend63, 0.08);
    macroNotes.push(`SPY 63d ${formatPct(h.spyTrend63)}`);
  }
  if (raw.spy) {
    const spy21 = periodReturnSafe(raw.spy.closes, 21);
    if (spy21 != null) {
      macro += -0.12 * tanhScore(spy21, 0.06);
      macroNotes.push(`SPY 21d ${formatPct(spy21)}`);
    }
  }
  if (h.vixLevel != null) {
    macro += 0.32 * scoreBand(h.vixLevel, { low: 14, high: 28 }, true);
    macroNotes.push(`VIX ${h.vixLevel.toFixed(1)}`);
    if (h.betaSpy != null && h.betaSpy > 1.3 && h.vixLevel > 22) {
      macro -= 0.18;
      macroNotes.push("High β into elevated VIX");
    }
  }
  if (h.vixTrend != null) macro += 0.12 * tanhScore(-h.vixTrend, 0.15);
  if (h.tnxChg21 != null) {
    const w = snap.isAiHighGrowth ? 0.38 : snap.isCommodityLike ? 0.12 : 0.22;
    macro += -w * tanhScore(h.tnxChg21, 0.18);
    macroNotes.push(`10y yield 21d ${h.tnxChg21 >= 0 ? "+" : ""}${h.tnxChg21.toFixed(2)} pts`);
  }
  if (h.uupRet21 != null) {
    const w = snap.isCommodityLike ? 0.32 : 0.14;
    macro += -w * tanhScore(h.uupRet21, 0.02);
    macroNotes.push(`USD 21d ${formatPct(h.uupRet21)}`);
  }
  if (h.hygRet21 != null) {
    macro += 0.22 * tanhScore(h.hygRet21, 0.025);
    macroNotes.push(`HY credit 21d ${formatPct(h.hygRet21)}`);
  }
  macro = clamp(macro, -1, 1);
  const macroConf = clamp(0.4 + Math.abs(macro) * 0.25, 0.35, 0.75);

  const indNotes: string[] = [];
  let ind = 0;
  let indConf = 0.3;
  if (snap.relSpy63d != null) {
    ind += 0.35 * tanhScore(snap.relSpy63d, 0.08);
    indNotes.push(`63d RS ${formatPct(snap.relSpy63d)}`);
    indConf += 0.15;
  }
  if (snap.relSpy126d != null) {
    ind += 0.3 * tanhScore(snap.relSpy126d, 0.12);
    indNotes.push(`126d RS ${formatPct(snap.relSpy126d)}`);
  }
  if (snap.sector) indNotes.push(`Sector: ${snap.sector}`);
  if (snap.isAiHighGrowth && (snap.peApprox ?? 0) > 50) {
    ind -= 0.1;
    indNotes.push("Stretched AI valuation");
  }
  if (snap.aboveSma200 != null) ind += snap.aboveSma200 ? 0.1 : -0.1;
  if (snap.isAiHighGrowth && political < -0.2) ind -= 0.08;
  ind = clamp(ind, -1, 1);
  indConf = clamp(indConf, 0.25, 0.72);

  const govNotes: string[] = [...(snap.governance?.notes ?? [])];
  let gov = snap.governance?.insiderSignal ?? 0;
  let govConf = snap.governance?.form4Count90d != null ? 0.45 : 0.2;
  if ((snap.roe ?? 0) > 0.2 && (snap.revGrowthYoy ?? 0) > 0) gov += 0.08;
  gov = clamp(gov, -1, 1);
  govConf = clamp(govConf, 0.2, 0.65);

  const liquidityFlag: RiskView["liquidityFlag"] =
    h.avgDollarVol == null
      ? "unknown"
      : h.avgDollarVol > 50_000_000
        ? "high"
        : h.avgDollarVol > 5_000_000
          ? "medium"
          : "low";

  const betaSpy = h.betaSpy ?? 1;
  const vol = h.vol63 ?? 0.25;
  const stress = [
    `If market −15% to −20%, β-scaled ~${formatPct(-0.15 * betaSpy)} to ${formatPct(-0.2 * betaSpy)} (β≈${betaSpy.toFixed(2)}).`,
    `~1.5σ 3M adverse ~${formatPct(-1.5 * vol * Math.sqrt(63 / 252))} (stress only).`,
    `Est. RT friction ~${frictionBps} bps.`,
  ];
  if (h.vixLevel != null && h.vixLevel < 14) stress.push("Complacent VIX.");
  if (liquidityFlag === "low") stress.push("Thin liquidity.");

  const riskNotes: string[] = [];
  if (h.vol21 != null) riskNotes.push(`21d vol ${(h.vol21 * 100).toFixed(1)}%`);
  if (h.vol63 != null) riskNotes.push(`63d vol ${(h.vol63 * 100).toFixed(1)}%`);
  if (h.betaSpy != null) riskNotes.push(`β ${h.betaSpy.toFixed(2)}`);
  if (h.mdd != null) riskNotes.push(`~6m max DD ${formatPct(h.mdd)}`);
  riskNotes.push(`Liquidity ${liquidityFlag} · ~${frictionBps} bps RT`);

  const modules: ModuleScore[] = [
    {
      id: "fundamentals",
      label: "Fundamentals & quality",
      score: fund,
      confidence: fundConf,
      notes: fundNotes,
      halfLife: "months",
    },
    {
      id: "valuation",
      label: "Valuation",
      score: val,
      confidence: valConf,
      notes: valNotes,
      halfLife: "months",
    },
    {
      id: "earnings",
      label: "Earnings & growth path",
      score: earn,
      confidence: earnConf,
      notes: earnNotes,
      halfLife: "weeks to months",
    },
    {
      id: "macro",
      label: "Macro / regime",
      score: macro,
      confidence: macroConf,
      notes: macroNotes,
      halfLife: "days to weeks",
    },
    {
      id: "industry",
      label: "Industry & competition",
      score: ind,
      confidence: indConf,
      notes: indNotes,
      halfLife: "months",
    },
    {
      id: "reversal",
      label: "Short-term setup",
      score: rev,
      confidence: revConf,
      notes: revNotes,
      halfLife: "days to weeks",
    },
    {
      id: "momentum",
      label: "Intermediate trend",
      score: mom,
      confidence: momConf,
      notes: momNotes,
      halfLife: "weeks to months",
    },
    {
      id: "sentiment",
      label: "News sentiment",
      score: sent,
      confidence: sentConf,
      notes: sentNotes,
      halfLife: "minutes to days",
    },
    {
      id: "social",
      label: "Chatter (StockTwits, Reddit, X)",
      score: social,
      confidence: socialConf,
      notes: socNotes,
      halfLife: "minutes to days",
    },
    {
      id: "money",
      label: "Big money & key people",
      score: money,
      confidence: moneyConf,
      notes: moneyNotes,
      halfLife: "days to weeks",
    },
    {
      id: "psychology",
      label: "Investor psychology",
      score: psych,
      confidence: psychConf,
      notes: psychNotes,
      halfLife: "days",
    },
    {
      id: "calendar",
      label: "Market dates",
      score: cal,
      confidence: calConf,
      notes: calNotes,
      halfLife: "days",
    },
    {
      id: "competitors",
      label: "Competitors",
      score: comp,
      confidence: compConf,
      notes: compNotes,
      halfLife: "weeks",
    },
    {
      id: "lowVol",
      label: "Low volatility",
      score: lvScore,
      confidence: lvConf,
      notes: lvNotes,
      halfLife: "months",
    },
    {
      id: "otherFactors",
      label: "Other (growth, dividend, insiders, liquidity)",
      score: otherScore,
      confidence: otherConf,
      notes: otherNotes,
      halfLife: "months",
    },
    {
      id: "political",
      label: "Political / policy chatter",
      score: political,
      confidence: politicalConf,
      notes: polNotes,
      halfLife: "days to weeks",
    },
    {
      id: "positioning",
      label: "Positioning & liquidity",
      score: pos,
      confidence: posConf,
      notes: posNotes,
      halfLife: "weeks",
    },
    {
      id: "governance",
      label: "Governance & insider activity",
      score: gov,
      confidence: govConf,
      notes: govNotes,
      halfLife: "weeks to months",
    },
    {
      id: "risk",
      label: "Risk factors",
      score: 0,
      confidence: 0.75,
      notes: riskNotes,
      halfLife: "persistent / regime-dependent",
    },
  ];

  const risk: RiskView = {
    realizedVol21d: h.vol21,
    realizedVol63d: h.vol63,
    betaSpy: h.betaSpy,
    maxDrawdown6m: h.mdd,
    avgDollarVolume: h.avgDollarVol,
    liquidityFlag,
    estimatedRoundTripBps: frictionBps,
    stressScenarios: stress,
    riskNotes,
  };

  return { modules, risk, snapshot: snap };
}

function periodReturnSafe(closes: number[], lookback: number): number | null {
  if (closes.length < lookback + 1) return null;
  const a = closes[closes.length - 1 - lookback]!;
  const b = closes[closes.length - 1]!;
  if (a <= 0 || b <= 0) return null;
  return b / a - 1;
}

const HORIZON_DAYS: Record<Horizon, number> = {
  "1m": 21,
  "3m": 63,
  "6m": 126,
};

/**
 * Map score + that stock’s own volatility into an anticipated % change
 * and an 80% interval. Neutral / abstain sit near 0% with a wide band.
 * This is a vol-scaled sketch, not a price target.
 */
function horizonMove(
  hz: Horizon,
  score: number,
  direction: Direction,
  abstain: boolean,
  confidence: number,
  risk: RiskView,
): {
  expectedReturn: number;
  ciLow: number;
  ciHigh: number;
  ciLevel: number;
  horizonVol: number;
} {
  const days = HORIZON_DAYS[hz];
  const ann = risk.realizedVol63d ?? risk.realizedVol21d ?? 0.28;
  const horizonVol = clamp(ann * Math.sqrt(days / 252), 0.025, 0.9);

  const capture = hz === "1m" ? 0.45 : hz === "3m" ? 0.5 : 0.52;
  let expected = score * capture * horizonVol;
  if (abstain) expected *= 0.5;
  const friction = (risk.estimatedRoundTripBps ?? 15) / 20000;
  if (Math.abs(expected) > friction) expected -= Math.sign(expected) * friction;
  else expected = 0;
  expected = clamp(expected, -1.15 * horizonVol, 1.15 * horizonVol);

  const z = 1.28155 * clamp(1.08 + (62 - confidence) / 100, 0.95, 1.5);
  return {
    expectedReturn: round(expected, 4),
    ciLow: round(expected - z * horizonVol, 4),
    ciHigh: round(expected + z * horizonVol, 4),
    ciLevel: 80,
    horizonVol: round(horizonVol, 4),
  };
}

export function synthesizeHorizons(
  modules: ModuleScore[],
  risk: RiskView,
  snap?: ConfirmCtx,
): HorizonForecast[] {
  const byId = Object.fromEntries(modules.map((m) => [m.id, m])) as Record<
    string,
    ModuleScore
  >;
  const friction = risk.estimatedRoundTripBps ?? 15;
  const frictionRet = friction / 10000;

  return (["1m", "3m", "6m"] as Horizon[]).map((hz) => {
    const cfg = HORIZON_WEIGHTS[hz];
    let score = 0;
    let weightSum = 0;
    let confMass = 0;
    const contrib: { id: string; w: number; s: number; c: number }[] = [];

    for (const [id, w] of Object.entries(cfg.modules)) {
      const m = byId[id];
      if (!m) continue;
      const effective = w * (0.5 + 0.5 * m.confidence);
      score += m.score * effective;
      weightSum += effective;
      confMass += m.confidence * w;
      contrib.push({ id, w, s: m.score, c: m.confidence });
    }
    score = weightSum > 0 ? score / weightSum : 0;

    let gateNote: string | undefined;
    if (hz === "1m") {
      const mom = byId.momentum?.score ?? 0;
      const rev = byId.reversal?.score ?? 0;
      const conf = oneMonthConfirmation(mom, rev, score, snap);
      score = conf.score;
      gateNote = conf.note;

      const threeCfg = HORIZON_WEIGHTS["3m"];
      let three = 0;
      let threeW = 0;
      for (const [id, w] of Object.entries(threeCfg.modules)) {
        const m = byId[id];
        if (!m) continue;
        const effective = w * (0.5 + 0.5 * m.confidence);
        three += m.score * effective;
        threeW += effective;
      }
      three = threeW > 0 ? three / threeW : 0;
      if (score > 0 && three < -0.22) {
        score *= 0.08;
        gateNote = "1M blocked: 3-month lean is down";
      }
    }

    if ((risk.realizedVol21d ?? 0) > 0.55) score *= 0.8;

    const signed = contrib.filter((c) => Math.abs(c.s) > 0.15);
    const posC = signed.filter((c) => c.s > 0).length;
    const negC = signed.filter((c) => c.s < 0).length;
    const conflict = posC > 0 && negC > 0 && Math.abs(posC - negC) <= 1;

    const edgeProxy = Math.abs(score) * 0.08;
    if (edgeProxy < frictionRet * 1.5) score *= 0.5;

    let rawConf =
      52 +
      Math.abs(score) * 34 +
      (confMass - 0.4) * 10 -
      (conflict ? 8 : 0) -
      (risk.liquidityFlag === "low" ? 10 : risk.liquidityFlag === "medium" ? 4 : 0) -
      ((risk.realizedVol63d ?? 0) > 0.55 ? 6 : 0) -
      Math.min(8, friction / 10);

    let direction = directionFromScore(score, cfg.dirThreshold);
    let abstain = false;
    let abstainReason: string | undefined;

    const thinEdge = Math.abs(score) < cfg.dirThreshold * 0.9;
    if (conflict || thinEdge) {
      direction = "Neutral";
      rawConf = Math.min(rawConf, 56);
      if (Math.abs(score) < cfg.dirThreshold * 0.55 || edgeProxy < frictionRet) {
        abstain = true;
        abstainReason = "Abstain – insufficient edge after costs / no confirmation";
        rawConf = Math.min(rawConf, 52);
      }
    }

    if (direction === "Neutral") rawConf = Math.min(rawConf, 56);
    const rawCalibrated = calibrateConfidence(rawConf, confMass);
    const confidence = finalConfidence({
      horizon: hz,
      direction,
      abstain,
      score,
      rawCalibrated,
    });

    const ranked = [...contrib].sort(
      (a, b) => Math.abs(b.s * b.w) - Math.abs(a.s * a.w),
    );
    const drivers = ranked.slice(0, 3).map((c) => {
      const label = byId[c.id]?.label ?? c.id;
      const lean = c.s > 0.12 ? "bullish" : c.s < -0.12 ? "bearish" : "muted";
      return `${label} (${lean})`;
    });
    if (gateNote) drivers.unshift(gateNote);

    const move = horizonMove(hz, score, direction, abstain, confidence, risk);

    return {
      horizon: hz,
      label: cfg.label,
      direction,
      confidence,
      score: round(score, 3),
      abstain,
      abstainReason,
      weights: cfg.modules,
      drivers: drivers.slice(0, 4),
      frictionBps: friction,
      ...move,
    };
  });
}

export function blendTrainedOutlook(
  horizons: HorizonForecast[],
  raw: RawBundle,
  extra?: {
    percentile: number | null;
    ret21d: number | null;
    rsi14: number | null;
    earnScore: number;
    fundScore: number;
    frictionBps?: number;
    skipDisplayCalibrate?: boolean;
    skipLongerHorizons?: boolean;
    ticker?: string;
    spyRet21d?: number | null;
  },
): HorizonForecast[] {
  const p1 = trainOutlook(raw.bar, raw.spy, raw.tnx, 21);
  const unused: ReturnType<typeof trainOutlook> = {
    used: false,
    expectedReturn: 0,
    residualVol: 0.08,
    pUp: 0.5,
    n: 0,
  };
  const p3 = extra?.skipLongerHorizons ? unused : trainOutlook(raw.bar, raw.spy, raw.tnx, 63);
  const p6 = extra?.skipLongerHorizons ? unused : trainOutlook(raw.bar, raw.spy, raw.tnx, 126);
  const z = 1.28155;

  return horizons.map((h) => {
    const p = h.horizon === "1m" ? p1 : h.horizon === "3m" ? p3 : p6;
    const z = 1.28155;
    let expected = p.used ? p.expectedReturn : h.expectedReturn;
    if (h.horizon === "1m") expected = clamp(expected, -0.3, 0.3);
    else if (h.horizon === "3m") expected = clamp(expected, -0.28, 0.28);
    else expected = clamp(expected, -0.38, 0.38);
    const vol = p.used ? p.residualVol : h.horizonVol;

    if (h.horizon !== "1m") {
      if (!p.used) return h;
      let direction: Direction = "Neutral";
      let abstain = false;
      let confidence = h.confidence;
      if (expected > 0.008) {
        direction = "Increase";
        confidence = clamp(Math.round(p.pUp * 100), 52, 84);
      } else if (expected < -0.008) {
        direction = "Decrease";
        confidence = clamp(Math.round((1 - p.pUp) * 100), 52, 84);
      } else {
        abstain = true;
        confidence = clamp(Math.round(50 + (p.pUp - 0.5) * 30), 48, 58);
      }
      return {
        ...h,
        direction,
        abstain,
        abstainReason: undefined,
        confidence,
        expectedReturn: round(expected, 4),
        ciLow: round(expected - z * vol, 4),
        ciHigh: round(expected + z * vol, 4),
        horizonVol: round(vol, 4),
        drivers: [
          `History-trained ${h.horizon === "3m" ? "3-month" : "6-month"} ${formatPct(expected)} (${Math.round(p.pUp * 100)}% chance of a rise, n=${p.n})`,
          ...h.drivers,
        ].slice(0, 4),
      };
    }

    const rt = (extra?.frictionBps ?? 15) / 10000;
    const costFloor = Math.max(0.008, rt * 2);
    const ticker = extra?.ticker ?? raw.bar.symbol;
    if (!p.used) {
      return {
        ...h,
        direction: "Neutral" as Direction,
        confidence: 54,
        abstain: true,
        abstainReason: "Not enough history for a next-month rise call",
        expectedReturn: 0,
        ciLow: round(-z * vol, 4),
        ciHigh: round(z * vol, 4),
        horizonVol: round(vol, 4),
        drivers: ["1M muted: not enough trained history", ...h.drivers].slice(0, 4),
      };
    }
    if (isForeignListing(ticker)) {
      return {
        ...h,
        direction: "Neutral" as Direction,
        confidence: 54,
        abstain: true,
        abstainReason: "Non-US listing — different close than this tape",
        expectedReturn: 0,
        ciLow: round(-z * vol, 4),
        ciHigh: round(z * vol, 4),
        horizonVol: round(vol, 4),
        drivers: ["1M muted: non-US listing vs this tape", ...h.drivers].slice(0, 4),
      };
    }
    if (isLeveredEtf(ticker)) {
      return {
        ...h,
        direction: "Neutral" as Direction,
        confidence: 54,
        abstain: true,
        abstainReason: "Levered ETF — daily reset, not a 1-month stock call",
        expectedReturn: 0,
        ciLow: round(-z * vol, 4),
        ciHigh: round(z * vol, 4),
        horizonVol: round(vol, 4),
        drivers: ["1M muted: levered ETF", ...h.drivers].slice(0, 4),
      };
    }
    if (p3.used && p3.expectedReturn < -0.02) {
      return {
        ...h,
        direction: "Neutral" as Direction,
        confidence: clamp(Math.round(50 + (p.pUp - 0.5) * 20), 48, 58),
        abstain: true,
        abstainReason: "3-month lean is down — no next-month rise call",
        expectedReturn: 0,
        ciLow: round(-z * vol, 4),
        ciHigh: round(z * vol, 4),
        horizonVol: round(vol, 4),
        drivers: ["1M muted: 3-month lean is down", ...h.drivers].slice(0, 4),
      };
    }

    let direction: Direction = "Neutral";
    let abstain = true;
    let confidence = clamp(Math.round(50 + (p.pUp - 0.5) * 30), 48, 58);
    const extraDrivers: string[] = [];
    const monthDown = extra?.spyRet21d != null && extra.spyRet21d < 0;
    if (expected > costFloor && p.pUp >= 0.56) {
      direction = "Increase";
      abstain = false;
      let raw = clamp(Math.round(p.pUp * 100), 52, 80);
      if (monthDown) raw = Math.max(52, raw - 3);
      confidence = raw;
      extraDrivers.push(
        `History-trained next-month ${formatPct(expected)} (${confidence}% chance of a rise after shrinking a noisy 21-day fit, n=${p.n})`,
      );
    } else if (expected < -costFloor && p.pUp <= 0.44) {
      direction = "Decrease";
      abstain = false;
      confidence = clamp(Math.round((1 - p.pUp) * 100), 52, 80);
      extraDrivers.push(
        `History-trained next-month ${formatPct(expected)} (${confidence}% chance of a fall, n=${p.n})`,
      );
    } else {
      expected = 0;
      extraDrivers.push(
        p.pUp < 0.7
          ? `Next-month model is ${Math.round(p.pUp * 100)}% — under 70%, so no rise call`
          : "Next-month expected move is smaller than trading costs",
      );
    }
    return {
      ...h,
      direction,
      confidence,
      abstain,
      abstainReason: abstain ? extraDrivers[0] : undefined,
      expectedReturn: round(expected, 4),
      ciLow: round(expected - z * vol, 4),
      ciHigh: round(expected + z * vol, 4),
      horizonVol: round(vol, 4),
      drivers: [...extraDrivers, ...h.drivers].slice(0, 4),
    };
  });
}

function keyDriversLine(modules: ModuleScore[], horizons: HorizonForecast[]): string {
  const why = highConfidenceNotes(horizons);
  if (why) return why;
  const h1 = horizons.find((h) => h.horizon === "1m");
  if (h1?.drivers[0]?.startsWith("1M")) {
    let line = h1.drivers.slice(0, 2).join("; ");
    if (h1.abstain) line += ". Abstain 1M";
    if (line.length > 220) line = line.slice(0, 217) + "…";
    return line;
  }
  const directional = modules
    .filter((m) => m.id !== "risk")
    .sort((a, b) => Math.abs(b.score * b.confidence) - Math.abs(a.score * a.confidence));
  const bits = directional.slice(0, 2).map((m) => {
    const lean = m.score > 0.1 ? "+" : m.score < -0.1 ? "−" : "~";
    return `${m.label} ${lean}`;
  });
  let line = bits.join("; ");
  if (line.length > 160) line = line.slice(0, 157) + "…";
  return line || "Signals mixed; default Neutral.";
}

const emptyRisk = (): RiskView => ({
  realizedVol21d: null,
  realizedVol63d: null,
  betaSpy: null,
  maxDrawdown6m: null,
  avgDollarVolume: null,
  liquidityFlag: "unknown",
  estimatedRoundTripBps: null,
  stressScenarios: [],
  riskNotes: [],
});

export async function analyzeTicker(
  ticker: string,
  shared?: {
    spy?: BarSeries | null;
    vix?: BarSeries | null;
    tnx?: BarSeries | null;
    uup?: BarSeries | null;
    hyg?: BarSeries | null;
    light?: boolean;
    peerSnaps?: import("./peer-tape").PeerSnap[];
    forceLeader?: boolean;
  },
): Promise<TickerAnalysis> {
  const t = ticker.toUpperCase().trim();
  try {
    const raw = await fetchRawBundle(t, {
      chartRange: "2y",
      spy: shared?.spy,
      vix: shared?.vix,
      tnx: shared?.tnx,
      uup: shared?.uup,
      hyg: shared?.hyg,
      light: shared?.light,
    });
    if (!raw) {
      return {
        ticker: t,
        snapshot: null,
        modules: [],
        horizons: [],
        risk: emptyRisk(),
        keyDrivers: "No market data returned for ticker.",
        methodologyNote: "",
        error: `Could not load market data for ${t}. Check the symbol and try again.`,
      };
    }
    const { modules, risk, snapshot } = scoreModules(raw);
    const peers = shared?.peerSnaps ?? (await livePeerSnaps());
    const percentile =
      snapshot.ret21d != null && snapshot.ret63d != null
        ? peerPercentile(peers, snapshot.ret21d, snapshot.ret63d)
        : null;
    const horizons = attachWhy(
      blendTrainedOutlook(
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
          tnxChg21: getSeriesHelpers(raw).tnxChg21,
          ticker: t,
          isGroupLeader:
            shared?.forceLeader === true ||
            isGroupLeader(peers, t, snapshot.ret21d, snapshot.ret63d),
          isTopLeader: false,
          vixLevel: getSeriesHelpers(raw).vixLevel,
          vixTrend: getSeriesHelpers(raw).vixTrend,
          hygRet21: getSeriesHelpers(raw).hygRet21,
        }),
        raw,
        {
          percentile,
          ret21d: snapshot.ret21d,
          rsi14: snapshot.rsi14,
          earnScore: modules.find((m) => m.id === "earnings")?.score ?? 0,
          fundScore: modules.find((m) => m.id === "fundamentals")?.score ?? 0,
          frictionBps: risk.estimatedRoundTripBps ?? 15,
          ticker: t,
          spyRet21d:
            snapshot.ret21d != null && snapshot.relSpy21d != null
              ? snapshot.ret21d - snapshot.relSpy21d
              : null,
        },
      ),
      snapshot,
      modules,
    );
    const quantRaw = rawQuantFactors(snapshot, risk.realizedVol63d, risk.betaSpy);
    return {
      ticker: t,
      snapshot,
      modules,
      horizons,
      risk,
      keyDrivers: keyDriversLine(modules, horizons),
      methodologyNote:
        "1-month rise is tape-only: market up, fear not high or rising, junk bonds not sliding, the name leading its own group, beating the market, US-listed vs this tape, and the expected move bigger than costs. Quant rank is a separate “own this?” score. Confidence shrinks toward history.",
      quantRaw,
      quantScore: null,
    };
  } catch (e) {
    return {
      ticker: t,
      snapshot: null,
      modules: [],
      horizons: [],
      risk: emptyRisk(),
      keyDrivers: "",
      methodologyNote: "",
      error: e instanceof Error ? e.message : "Analysis failed",
    };
  }
}

export async function analyzeTickers(tickers: string[]): Promise<AnalysisReport> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase().trim()).filter(Boolean))].slice(
    0,
    30,
  );
  const [macro, peerSnaps] = await Promise.all([prefetchMacro("2y"), livePeerSnaps()]);
  const results: TickerAnalysis[] = [];
  const queue = [...unique];
  const concurrency = Math.min(5, Math.max(1, unique.length));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        results.push(await analyzeTicker(t, { ...macro, peerSnaps }));
      }
    }),
  );
  results.sort(compareLikelyRise);
  attachQuantRanks(results);

  const tape = classifyTape(tapeInputsFromBars(macro.spy ?? null, macro.vix ?? null, macro.hyg ?? null));
  if (tape.suppressRiseCalls) {
    for (const r of results) {
      for (const h of r.horizons) {
        if (h.horizon !== "1m") continue;
        if (h.direction === "Increase" && !h.abstain) {
          h.direction = "Neutral";
          h.abstain = true;
          h.expectedReturn = 0;
          h.abstainReason = "Bear tape — no 1-month rise calls";
          h.drivers = ["1M blocked: market weather is Bear tape", ...h.drivers].slice(0, 4);
        }
      }
    }
    results.sort(compareLikelyRise);
  }

  const scored = results.filter((r) => r.snapshot && !r.error);
  const holdSrc = [...scored].sort((a, b) => {
    const am = quantGroup(a.ticker, a.snapshot?.industry) === "metals" ? 0 : 1;
    const bm = quantGroup(b.ticker, b.snapshot?.industry) === "metals" ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.risk.realizedVol63d ?? 99) - (b.risk.realizedVol63d ?? 99);
  });
  const breakSrc = [...scored].sort(
    (a, b) => (a.snapshot?.ret21d ?? 0) - (b.snapshot?.ret21d ?? 0),
  );
  const named = (r: TickerAnalysis) => ({
    ticker: r.ticker,
    name: TICKER_PROFILE[r.ticker]?.name ?? r.snapshot?.name ?? displayTicker(r.ticker),
  });

  const abstainNotes: string[] = [];
  for (const r of results) {
    for (const h of r.horizons) {
      if (h.abstain) {
        abstainNotes.push(
          `${r.ticker} ${h.label}: ${h.abstainReason ?? "Abstain – insufficient edge"}`,
        );
      }
    }
    if (r.risk.liquidityFlag === "low") {
      abstainNotes.push(`${r.ticker}: size very small — liquidity/friction.`);
    }
  }

  return {
    asOf: new Date().toISOString(),
    tickers: unique,
    results,
    overallMethodology:
      "1-month rise = market up, VIX under 20, name leading its group, not stretched, beating SPY, US-listed vs this tape, expected move bigger than costs.",
    keyRisks: [
      "Sharp reversals still fake out last month’s winners.",
      "70 of 100 is the app’s rise bar from that ranking rule, not a guarantee.",
      "Social/news free proxies are noise-heavy and damped.",
      "Stress scenarios are loss ranges, not probabilities.",
      ...results.flatMap((r) => r.risk.stressScenarios.slice(0, 1).map((s) => `${r.ticker}: ${s}`)),
    ].slice(0, 10),
    abstainNotes,
    disclaimer: DISCLAIMER,
    tape: {
      label: tape.label,
      reasons: tape.reasons,
      flipBack: tape.flipBack,
      suppressRiseCalls: tape.suppressRiseCalls,
      monthDown: tape.monthDown,
      holdUp: holdSrc.slice(0, 5).map(named),
      breakDown: breakSrc.slice(0, 5).map(named),
    },
  };
}
