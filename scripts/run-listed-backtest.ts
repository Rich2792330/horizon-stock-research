import { writeFileSync } from "node:fs";
import { runOneMonthBacktest } from "../src/lib/analysis/backtest";
import { LISTED_STOCKS } from "../src/lib/analysis/listed";

const report = await runOneMonthBacktest([...LISTED_STOCKS]);
const s = report.summary;
const pct = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const formatMaybe = (x: number | null) => {
  if (x == null) return "n/a";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)}%`;
};

const compact = {
  asOf: report.asOf,
  decisionDate: report.decisionDate,
  evalDate: report.evalDate,
  forwardDays: report.forwardDays,
  walkPeriods: report.walkPeriods,
  universe: report.universe,
  latestRows: report.latestRows,
  periods: report.periods,
  summary: report.summary,
  rows: report.latestRows,
};

const out = {
  universe: report.universe,
  walkPeriods: report.walkPeriods,
  forwardDays: report.forwardDays,
  n: s.n,
  nDirectional: s.nDirectional,
  nIncrease: s.nIncrease,
  n70: s.n70,
  directionalHitRate: s.directionalHitRate,
  increaseHitRate: s.increaseHitRate,
  hit70: s.hit70,
  beatSpyRate: s.beatSpyRate,
  avgReturnWhenIncrease: s.avgReturnWhenIncrease,
  avgReturnWhenDecrease: s.avgReturnWhenDecrease,
  notes: s.notes,
  regimes: s.regimes,
  banner: s.banner
    ? {
        nMonths: s.banner.nMonths,
        nBear: s.banner.nBear,
        nBull: s.banner.nBull,
        nChoppy: s.banner.nChoppy,
        bearSpyDownRate: s.banner.bearSpyDownRate,
        bullSpyUpRate: s.banner.bullSpyUpRate,
        holdUpBeatSpyInBear: s.banner.holdUpBeatSpyInBear,
        holdUpAvgInBear: s.banner.holdUpAvgInBear,
        spyAvgInBear: s.banner.spyAvgInBear,
        year2022: {
          nMonths: s.banner.year2022.nMonths,
          nBear: s.banner.year2022.nBear,
          nBull: s.banner.year2022.nBull,
          nChoppy: s.banner.year2022.nChoppy,
          bearSpyDownRate: s.banner.year2022.bearSpyDownRate,
          holdUpBeatSpyInBear: s.banner.year2022.holdUpBeatSpyInBear,
          holdUpAvgInBear: s.banner.year2022.holdUpAvgInBear,
          spyAvgInBear: s.banner.year2022.spyAvgInBear,
          listAvgInBear: s.banner.year2022.listAvgInBear,
          months: s.banner.year2022.months.map((m) => ({
            decisionDate: m.decisionDate,
            tape: m.tape,
            spyReturn: m.spyReturn,
            holdUpReturn: m.holdUpReturn,
            breakDownReturn: m.breakDownReturn,
            holdUpNames: m.holdUpNames,
            breakDownNames: m.breakDownNames,
            suppressRiseCalls: m.suppressRiseCalls,
            reasons: m.reasons,
          })),
        },
        year2020: {
          nMonths: s.banner.year2020.nMonths,
          nBear: s.banner.year2020.nBear,
          nBull: s.banner.year2020.nBull,
          nChoppy: s.banner.year2020.nChoppy,
          bearSpyDownRate: s.banner.year2020.bearSpyDownRate,
          holdUpBeatSpyInBear: s.banner.year2020.holdUpBeatSpyInBear,
        },
        notes: s.banner.notes,
      }
    : null,
  byTicker: report.universe.map((t) => {
    const rows = report.rows.filter((r) => r.ticker === t && !r.error);
    const dir = rows.filter((r) => r.forecastDirection !== "Neutral" && !r.abstain);
    const hits = dir.filter((r) => r.directionalHit === true);
    const inc = rows.filter((r) => r.forecastDirection === "Increase" && !r.abstain);
    const incHits = inc.filter((r) => r.actualReturn > 0.005);
    return {
      ticker: t,
      windows: rows.length,
      directionalCalls: dir.length,
      directionalHit: dir.length ? hits.length / dir.length : null,
      increaseCalls: inc.length,
      increaseHit: inc.length ? incHits.length / inc.length : null,
    };
  }),
};

console.log(JSON.stringify(out, null, 2));
console.log("\nPLAIN:");
console.log(`Windows: ${s.n} (about ${report.walkPeriods} months × ${report.universe.length} names)`);
console.log(`When it said up or down (not 'no call'): ${pct(s.directionalHitRate)} of ${s.nDirectional} calls were the right way`);
console.log(`When it said BUY/rise: ${pct(s.increaseHitRate)} of ${s.nIncrease} actually rose`);
console.log(`When it was 70%+ sure of a rise: ${pct(s.hit70)} of ${s.n70}`);
console.log(`Those rise calls beat the market: ${pct(s.beatSpyRate)}`);
for (const rg of s.regimes ?? []) {
  console.log(
    `${rg.label}: rise-call hit ${pct(rg.increaseHitRate)} of ${rg.nIncrease} (n=${rg.n}, 70%+ ${pct(rg.hit70)} of ${rg.n70})`,
  );
}
if (s.banner) {
  const b = s.banner;
  console.log("\nBANNER TEST:");
  console.log(
    `All years: ${b.nBear} Bear / ${b.nBull} Bull / ${b.nChoppy} Choppy of ${b.nMonths} months. After Bear, SPY fell next month ${pct(b.bearSpyDownRate)}. Hold-ups beat SPY ${pct(b.holdUpBeatSpyInBear)} of Bear months.`,
  );
  console.log(
    `2022: ${b.year2022.nBear} Bear / ${b.year2022.nBull} Bull / ${b.year2022.nChoppy} Choppy of ${b.year2022.nMonths}. SPY fell next month ${pct(b.year2022.bearSpyDownRate)} of Bear months. Hold-ups beat SPY ${pct(b.year2022.holdUpBeatSpyInBear)}. Hold-ups avg ${b.year2022.holdUpAvgInBear != null ? formatMaybe(b.year2022.holdUpAvgInBear) : "n/a"} vs SPY ${b.year2022.spyAvgInBear != null ? formatMaybe(b.year2022.spyAvgInBear) : "n/a"}. List avg ${b.year2022.listAvgInBear != null ? formatMaybe(b.year2022.listAvgInBear) : "n/a"}.`,
  );
  console.log(
    `2020: ${b.year2020.nBear} Bear / ${b.year2020.nBull} Bull / ${b.year2020.nChoppy} Choppy of ${b.year2020.nMonths}. SPY fell next month ${pct(b.year2020.bearSpyDownRate)} of Bear months.`,
  );
  for (const m of b.year2022.months) {
    console.log(
      `  ${m.decisionDate}  ${m.tape.padEnd(10)}  SPY ${formatMaybe(m.spyReturn)}  hold ${formatMaybe(m.holdUpReturn)}  break ${formatMaybe(m.breakDownReturn)}  ${m.holdUpNames.slice(0, 4).join(",")}`,
    );
  }
}

writeFileSync("/workspace/screenshots/listed-backtest.json", JSON.stringify(out, null, 2));
writeFileSync(
  "/workspace/src/lib/analysis/listed-backtest-snapshot.ts",
  `import type { BacktestReport } from "./backtest";\n\n/** Baked from the 10-year listed walk-forward (point-in-time prices only). */\nexport const LISTED_BACKTEST_SNAPSHOT: BacktestReport | null = ${JSON.stringify(compact, null, 2)} as BacktestReport;\n`,
);
console.log("\nWrote screenshots/listed-backtest.json and listed-backtest-snapshot.ts");
