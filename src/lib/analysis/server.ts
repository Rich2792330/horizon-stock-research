import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { analyzeTickers } from "./framework";
import { BACKTEST_UNIVERSE, runOneMonthBacktest } from "./backtest";
import type { BacktestReport } from "./backtest";
import { scanHighConfidenceRisers } from "./scan";
import { reviewListedActions } from "./action-review";
import { LISTED_STOCKS } from "./listed";
import { LISTED_BACKTEST_SNAPSHOT } from "./listed-backtest-snapshot";

const inputSchema = z.object({
  tickers: z.array(z.string().min(1).max(16)).min(1).max(30),
  fresh: z.boolean().optional(),
});

export const runHorizonAnalysis = createServerFn({ method: "POST" })
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const tickers = data.tickers.map((t) => t.toUpperCase().trim()).filter(Boolean);
    const { getListedAnalysis, isDefaultList } = await import("./listed-cache.server");
    if (isDefaultList(tickers)) {
      return getListedAnalysis({ fresh: data.fresh });
    }
    return analyzeTickers(tickers);
  });

const backtestSchema = z.object({
  tickers: z.array(z.string().min(1).max(12)).min(1).max(30).optional(),
});

function sameListed(tickers: string[]): boolean {
  if (tickers.length !== LISTED_STOCKS.length) return false;
  const set = new Set(tickers.map((t) => t.toUpperCase().trim()));
  return LISTED_STOCKS.every((t) => set.has(t));
}

let listedMem: BacktestReport | null = null;

export const runBacktest = createServerFn({ method: "POST" })
  .validator((data: unknown) => backtestSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const tickers = data.tickers?.length ? data.tickers : [...BACKTEST_UNIVERSE];
    if (sameListed(tickers)) {
      if (LISTED_BACKTEST_SNAPSHOT && LISTED_BACKTEST_SNAPSHOT.summary.n > 0) {
        return LISTED_BACKTEST_SNAPSHOT;
      }
      if (listedMem && listedMem.summary.n > 0) return listedMem;
      const report = await runOneMonthBacktest(tickers);
      listedMem = report;
      return report;
    }
    return runOneMonthBacktest(tickers);
  });

const scanSchema = z.object({
  minConfidence: z.number().min(50).max(95).optional(),
  offset: z.number().min(0).optional(),
  limit: z.number().min(1).max(40).optional(),
  confirmTickers: z.array(z.string().min(1).max(12)).max(20).optional(),
  fresh: z.boolean().optional(),
});

export const runRiserScan = createServerFn({ method: "POST" })
  .validator((data: unknown) => scanSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    if (data.confirmTickers?.length) {
      return scanHighConfidenceRisers({
        minConfidence: data.minConfidence ?? 70,
        confirmTickers: data.confirmTickers,
      });
    }
    const { peekRiserScan, idleRiserScan, getRiserScan } = await import("./scan-cache.server");
    if (data.fresh) return getRiserScan({ fresh: true });
    const peeked = peekRiserScan();
    if (peeked && peeked.done !== true) return peeked;
    return peeked ?? idleRiserScan();
  });

export const loadHomeDesk = createServerFn({ method: "POST" })
  .validator(() => ({}))
  .handler(async () => {
    const listedMod = await import("./listed-cache.server");
    const scanMod = await import("./scan-cache.server");
    const peekedListed = listedMod.peekListedAnalysis();
    scanMod.ensureScanLoop();
    return {
      listed: peekedListed ? listedMod.slimForHome(peekedListed) : null,
      scan: scanMod.peekRiserScan(),
    };
  });

const actionSchema = z.object({
  tickers: z.array(z.string().min(1).max(12)).min(1).max(30).optional(),
});

export const runActionReview = createServerFn({ method: "POST" })
  .validator((data: unknown) => actionSchema.parse(data ?? {}))
  .handler(async ({ data }) => {
    const tickers = data.tickers?.length ? data.tickers : [...LISTED_STOCKS];
    return reviewListedActions({ tickers });
  });
