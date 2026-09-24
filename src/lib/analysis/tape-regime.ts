import { periodReturn, sma } from "./indicators";
import type { BarSeries } from "./market-data";

export type TapeLabel = "Bull tape" | "Bear tape" | "Choppy";

export interface TapeInputs {
  spyClose: number | null;
  spySma50: number | null;
  spySma200: number | null;
  spyRet21: number | null;
  vixLevel: number | null;
  vixTrend21: number | null;
  hygRet21: number | null;
}

export interface TapeReading {
  label: TapeLabel;
  reasons: string[];
  aboveSma200: boolean | null;
  aboveSma50: boolean | null;
  fearRising: boolean;
  creditWeak: boolean;
  /** True when 1-month rise calls should pause even on Bull tape. */
  monthDown: boolean;
  suppressRiseCalls: boolean;
  flipBack: string[];
}

export const BANNER_RULE =
  "Bear tape only if SPY is below both its 50-day and 200-day, the last month is still down, and fear or credit is still stressed — not if the 50-day has been reclaimed or fear and credit are both healing. Hold-ups are metals plus the calmer names, not last-quarter’s winners.";

export function tapeInputsFromBars(
  spy: BarSeries | null,
  vix: BarSeries | null,
  hyg: BarSeries | null,
): TapeInputs {
  const spyClose = spy && spy.closes.length ? spy.closes[spy.closes.length - 1]! : null;
  const spySma50 = spy ? sma(spy.closes, 50) : null;
  const spySma200 = spy ? sma(spy.closes, 200) : null;
  const spyRet21 = spy ? periodReturn(spy.closes, 21) : null;
  const vixLevel = vix && vix.closes.length ? vix.closes[vix.closes.length - 1]! : null;
  const vixTrend21 =
    vix && vix.closes.length > 21
      ? vix.closes[vix.closes.length - 1]! / vix.closes[vix.closes.length - 22]! - 1
      : null;
  const hygRet21 = hyg ? periodReturn(hyg.closes, 21) : null;
  return { spyClose, spySma50, spySma200, spyRet21, vixLevel, vixTrend21, hygRet21 };
}

/**
 * v2 banner (after 2022 v1 failed as a timing tool):
 * v1 stayed Bear through bounce months because it only needed “below the 200-day + stress.”
 * v2 requires the medium-term trend still down (below 50-day and last month still red)
 * and drops Bear when fear and credit are both healing.
 */
export function classifyTape(i: TapeInputs): TapeReading {
  const aboveSma200 =
    i.spyClose != null && i.spySma200 != null ? i.spyClose > i.spySma200 : null;
  const aboveSma50 =
    i.spyClose != null && i.spySma50 != null ? i.spyClose > i.spySma50 : null;
  const monthDown = i.spyRet21 != null && i.spyRet21 < 0;
  const fearHigh = i.vixLevel != null && i.vixLevel >= 22;
  const fearRising = i.vixTrend21 != null && i.vixTrend21 > 0.12;
  const creditWeak = i.hygRet21 != null && i.hygRet21 < -0.02;
  const fearCooling = i.vixTrend21 != null && i.vixTrend21 < 0;
  const creditHealing = i.hygRet21 != null && i.hygRet21 > 0;
  const healing = fearCooling && creditHealing;
  const stressOn = fearHigh || fearRising || creditWeak;

  const reasons: string[] = [];
  const flipBack: string[] = [];

  if (aboveSma200 === true) reasons.push("SPY is above its 200-day average");
  else if (aboveSma200 === false) reasons.push("SPY is below its 200-day average");
  else reasons.push("Not enough SPY history for a 200-day average");

  if (aboveSma50 === true) reasons.push("and above its 50-day");
  else if (aboveSma50 === false) reasons.push("and below its 50-day");

  if (monthDown) reasons.push("but the last month is still down");
  else if (i.spyRet21 != null && i.spyRet21 > 0) reasons.push("and the last month is already up");

  if (fearHigh) reasons.push(`Fear is high (VIX ${i.vixLevel!.toFixed(0)})`);
  else if (fearRising) reasons.push("Fear is rising");
  else if (fearCooling) reasons.push("Fear is cooling");
  if (creditWeak) reasons.push("Junk bonds are sliding");
  else if (creditHealing) reasons.push("Credit is stabilizing");
  if (healing) reasons.push("Fear and credit are both healing — not a fresh Bear");

  let label: TapeLabel;
  if (
    aboveSma200 === false &&
    aboveSma50 === false &&
    monthDown &&
    stressOn &&
    !healing
  ) {
    label = "Bear tape";
    flipBack.push("SPY reclaiming the 50-day");
    flipBack.push("A month that is no longer down");
    if (stressOn) flipBack.push("Fear cooling and junk bonds stopping their slide");
  } else if (
    aboveSma200 === true &&
    aboveSma50 !== false &&
    !fearHigh &&
    !fearRising &&
    !creditWeak
  ) {
    label = "Bull tape";
  } else {
    label = "Choppy";
    if (aboveSma200 === false) flipBack.push("SPY back above the 200-day");
    if (aboveSma50 === false) flipBack.push("SPY back above the 50-day");
    if (fearHigh || fearRising) flipBack.push("Fear cooling");
    if (creditWeak) flipBack.push("Credit stabilizing");
    if (!flipBack.length) {
      flipBack.push("SPY above both moving averages, with calm VIX and steady credit");
    }
  }

  return {
    label,
    reasons,
    aboveSma200,
    aboveSma50,
    fearRising: fearHigh || fearRising,
    creditWeak,
    monthDown,
    suppressRiseCalls: label === "Bear tape",
    flipBack,
  };
}

export function formatTapeLine(t: {
  reasons: string[];
  monthDown?: boolean;
  suppressRiseCalls?: boolean;
}): string {
  const lead = t.reasons.slice(0, 3).join(" ");
  const monthDown =
    t.monthDown ?? t.reasons.some((r) => /last month is still down/i.test(r));
  const pause = monthDown
    ? " 1-month rise calls are paused until that last month turns up."
    : t.suppressRiseCalls
      ? " 1-month rise calls are off until the weather flips."
      : " Read this weather before the forecast.";
  return `${lead}.${pause}`;
}
