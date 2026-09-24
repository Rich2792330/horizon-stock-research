import { prefetchMacro, fetchChart } from "../src/lib/analysis/market-data";
import { periodReturn } from "../src/lib/analysis/indicators";
import { trainOutlook } from "../src/lib/analysis/predict";
import { classifyTape, tapeInputsFromBars } from "../src/lib/analysis/tape-regime";
import { SCAN_UNIVERSE } from "../src/lib/analysis/scan-universe";
import { LISTED_STOCKS } from "../src/lib/analysis/listed";

const macro = await prefetchMacro("2y");
const tape = classifyTape(tapeInputsFromBars(macro.spy ?? null, macro.vix ?? null, macro.hyg ?? null));
const spy21 = macro.spy ? periodReturn(macro.spy.closes, 21) : null;
console.log({
  tape: tape.label,
  suppress: tape.suppressRiseCalls,
  monthDown: tape.monthDown,
  spy21,
  reasons: tape.reasons,
});

const names = [...new Set([...LISTED_STOCKS, "SMH", "ASML", "AVGO", "JPM", "COST", "QQQ", "NVDA", "META", "KLAC", "AMAT", "MU", "GOOG"])];
const hits: Array<{ t: string; pUp: number; exp: number }> = [];
for (const t of names) {
  const bar = await fetchChart(t, "2y");
  if (!bar) continue;
  const p1 = trainOutlook(bar, macro.spy, macro.tnx, 21);
  if (!p1.used) continue;
  if (p1.pUp >= 0.7 && p1.expectedReturn > 0.008) {
    hits.push({ t, pUp: p1.pUp, exp: p1.expectedReturn });
  }
}
hits.sort((a, b) => b.pUp - a.pUp);
console.log("1m pUp>=70 among listed+", hits);

// broader sample of first 40 universe
const more: typeof hits = [];
for (const t of SCAN_UNIVERSE.slice(0, 40)) {
  const bar = await fetchChart(t, "2y");
  if (!bar) continue;
  const p1 = trainOutlook(bar, macro.spy, macro.tnx, 21);
  if (p1.used && p1.pUp >= 0.7 && p1.expectedReturn > 0.008) {
    more.push({ t, pUp: p1.pUp, exp: p1.expectedReturn });
  }
}
more.sort((a, b) => b.pUp - a.pUp);
console.log("1m pUp>=70 in first 40 universe", more);
