/**
 * One-shot accuracy check — run via: npx vite-node scripts/run-backtest-once.mjs
 */
import { runOneMonthBacktest } from "../src/lib/analysis/backtest.ts";

const r = await runOneMonthBacktest();
const s = r.summary;
const latest = r.latestRows?.length
  ? r.latestRows
  : r.rows.filter((x) => x.period === 0);

const out = {
  directionalHitRate: s.directionalHitRate,
  nDirectional: s.nDirectional,
  n: s.n,
  scoreReturnCorr: s.scoreReturnCorr,
  longShortSpread: s.longShortSpread,
  periods: (r.periods ?? []).map((p) => ({
    period: p.period,
    decisionDate: p.decisionDate,
    evalDate: p.evalDate,
    hit: p.directionalHitRate,
    nDir: p.nDirectional,
  })),
  latest: latest.map((x) => ({
    t: x.ticker,
    forecast: x.forecastDirection,
    conf: x.forecastConfidence,
    actualRetPct: Math.round(x.actualReturn * 1000) / 10,
    hit: x.hit,
  })),
};

console.log(JSON.stringify(out, null, 2));
