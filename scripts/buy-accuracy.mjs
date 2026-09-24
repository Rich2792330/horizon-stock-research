import { runOneMonthBacktest } from "../src/lib/analysis/backtest.ts";

const r = await runOneMonthBacktest();
// Buy lean = 1M forecast Increase, not abstaining
const rows = r.rows.filter(
  (x) => !x.error && x.forecastDirection === "Increase" && !x.abstain,
);
const wins = rows.filter((x) => x.actualReturn > 0);
const lastMonth = rows.filter((x) => x.period === 0);
const lastWins = lastMonth.filter((x) => x.actualReturn > 0);

const byPeriod = {};
for (const row of rows) {
  byPeriod[row.period] ??= { n: 0, wins: 0 };
  byPeriod[row.period].n++;
  if (row.actualReturn > 0) byPeriod[row.period].wins++;
}

const avg = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b.actualReturn, 0) / xs.length : null;

console.log(
  JSON.stringify(
    {
      definition:
        "Said Increase (Buy lean) on 1M; correct if next ~21 trading days return > 0",
      allSixWindows: {
        buyCalls: rows.length,
        correct: wins.length,
        accuracyPct: rows.length
          ? Math.round((100 * wins.length) / rows.length)
          : null,
        avgReturnWhenBuyPct: avg(rows) != null ? Math.round(avg(rows) * 1000) / 10 : null,
      },
      lastMonthOnly: {
        decision: lastMonth[0]?.decisionDate ?? null,
        eval: lastMonth[0]?.evalDate ?? null,
        buyCalls: lastMonth.length,
        correct: lastWins.length,
        accuracyPct: lastMonth.length
          ? Math.round((100 * lastWins.length) / lastMonth.length)
          : null,
        details: lastMonth.map((x) => ({
          t: x.ticker,
          conf: x.forecastConfidence,
          retPct: Math.round(x.actualReturn * 1000) / 10,
          up: x.actualReturn > 0,
        })),
      },
      byPeriod: Object.entries(byPeriod)
        .sort((a, b) => +a[0] - +b[0])
        .map(([p, v]) => ({
          period: +p,
          buyCalls: v.n,
          correct: v.wins,
          pct: Math.round((100 * v.wins) / v.n),
        })),
    },
    null,
    2,
  ),
);
