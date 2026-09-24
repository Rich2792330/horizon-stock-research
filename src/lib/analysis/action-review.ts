import { analyzeTicker, DISCLAIMER } from "./framework";
import { LISTED_STOCKS, compareLikelyRise } from "./listed";
import { prefetchMacro } from "./market-data";
import { livePeerSnaps } from "./peer-tape";
import type { Direction, TickerAnalysis } from "./types";

export type Action = "Buy" | "Hold" | "Sell";

export interface ActionRow {
  ticker: string;
  name: string;
  industry: string | null;
  price: number | null;
  action: Action;
  reason: string;
  conf1m: number | null;
  dir1m: Direction | null;
  conf3m: number | null;
  dir3m: Direction | null;
  conf6m: number | null;
  dir6m: Direction | null;
  score1m: number | null;
  expected1m: number | null;
  ciLow1m: number | null;
  ciHigh1m: number | null;
  expected3m: number | null;
  ciLow3m: number | null;
  ciHigh3m: number | null;
  expected6m: number | null;
  ciLow6m: number | null;
  ciHigh6m: number | null;
  liquidityFlag: string;
  riskNote: string;
  error?: string;
}

export interface ActionReviewReport {
  asOf: string;
  universe: string[];
  rows: ActionRow[];
  summary: { buy: number; hold: number; sell: number; failed: number };
  notes: string[];
  disclaimer: string;
}

/**
 * Capital-preservation action from multi-horizon output.
 * Prefer Hold when mixed. Sell when short/medium horizons lean down.
 * Buy only when trend confirms without extension / high friction.
 */
export function decideAction(a: TickerAnalysis): { action: Action; reason: string } {
  if (a.error || !a.horizons.length) {
    return { action: "Hold", reason: "Could not load a full picture — default Hold." };
  }

  const h1 = a.horizons.find((h) => h.horizon === "1m");
  const h3 = a.horizons.find((h) => h.horizon === "3m");
  const h6 = a.horizons.find((h) => h.horizon === "6m");
  const risk = a.risk;

  const d1 = h1?.direction ?? "Neutral";
  const d3 = h3?.direction ?? "Neutral";
  const d6 = h6?.direction ?? "Neutral";
  const c1 = h1?.confidence ?? 50;
  const c3 = h3?.confidence ?? 50;
  const s1 = h1?.score ?? 0;
  const abstain1 = h1?.abstain ?? true;

  // —— Sell cases (checked first)
  if (d1 === "Decrease" && c1 >= 58 && !abstain1) {
    return {
      action: "Sell",
      reason:
        h1?.whyConfident ??
        `1-month leans down (${c1}% confidence). Consider reducing risk rather than adding.`,
    };
  }
  if (d1 === "Decrease" && d3 === "Decrease" && c3 >= 55) {
    return {
      action: "Sell",
      reason: "Both 1-month and 3-month lean down — poor setup to hold size for a bounce.",
    };
  }
  if (s1 <= -0.35 && d3 !== "Increase") {
    return {
      action: "Sell",
      reason: "Strong negative 1-month score without a 3-month cushion — favor cutting exposure.",
    };
  }
  if (
    risk.liquidityFlag === "low" &&
    (d1 === "Decrease" || d3 === "Decrease")
  ) {
    return {
      action: "Sell",
      reason: "Weak direction plus thin liquidity — hard to exit later; size down.",
    };
  }
  if (
    (risk.maxDrawdown6m ?? 0) < -0.35 &&
    d1 === "Decrease" &&
    c1 >= 52
  ) {
    return {
      action: "Sell",
      reason: "Already deep drawdown and 1-month still weak — prioritize capital preservation.",
    };
  }

  // —— Buy cases (strict)
  const notExtended =
    !(h1?.drivers.some((d) => /extended|blocked|crowded/i.test(d)) ?? false);
  if (
    d1 === "Increase" &&
    !abstain1 &&
    c1 >= 68 &&
    notExtended &&
    risk.liquidityFlag !== "low" &&
    d3 !== "Decrease"
  ) {
    return {
      action: "Buy",
      reason:
        h1?.whyConfident ??
        `1-month confirmed uptrend setup at ${c1}% confidence; 3-month not fighting it.`,
    };
  }
  if (
    d1 === "Increase" &&
    d3 === "Increase" &&
    c1 >= 60 &&
    c3 >= 55 &&
    !abstain1 &&
    risk.liquidityFlag !== "low"
  ) {
    return {
      action: "Buy",
      reason:
        [h1?.whyConfident, h3?.whyConfident].filter(Boolean).join(" ") ||
        "1-month and 3-month both lean up — constructive for a measured add.",
    };
  }
  if (
    d3 === "Increase" &&
    d6 === "Increase" &&
    c3 >= 60 &&
    s1 > -0.1 &&
    risk.liquidityFlag !== "low"
  ) {
    return {
      action: "Buy",
      reason: "Medium- and longer-term lean up with 1-month not broken — hold bias toward accumulate.",
    };
  }

  // —— Hold (default)
  if (abstain1 || d1 === "Neutral") {
    return {
      action: "Hold",
      reason:
        d3 === "Increase"
          ? "1-month unclear; 3-month softer positive — Hold, do not chase."
          : d3 === "Decrease"
            ? "1-month unclear and 3-month soft — Hold size, avoid adding."
            : "Mixed or muted signals — Hold and wait for a clearer setup.",
    };
  }
  if (d1 === "Increase" && c1 < 68) {
    return {
      action: "Hold",
      reason: `Lean up (${c1}%) but not strong enough for a Buy — Hold or small size only.`,
    };
  }
  if (d1 === "Decrease" && c1 < 58) {
    return {
      action: "Hold",
      reason: "Mild downside lean only — Hold and reassess; not a high-conviction Sell.",
    };
  }

  return {
    action: "Hold",
    reason: `Default Hold (1M ${d1} ${c1}%, 3M ${d3}, score ${s1.toFixed(2)}).`,
  };
}

export async function reviewListedActions(opts?: {
  tickers?: string[];
}): Promise<ActionReviewReport> {
  const universe = [
    ...new Set(
      (opts?.tickers ?? [...LISTED_STOCKS]).map((t) => t.toUpperCase().trim()).filter(Boolean),
    ),
  ];

  const [macro, peerSnaps] = await Promise.all([prefetchMacro("2y"), livePeerSnaps()]);
  const analyses: TickerAnalysis[] = [];
  const queue = [...universe];
  const concurrency = Math.min(4, universe.length || 1);

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const t = queue.shift();
        if (!t) break;
        analyses.push(await analyzeTicker(t, { ...macro, peerSnaps }));
      }
    }),
  );

  analyses.sort(compareLikelyRise);

  const rows: ActionRow[] = analyses.map((a) => {
    const { action, reason } = decideAction(a);
    const h1 = a.horizons.find((h) => h.horizon === "1m");
    const h3 = a.horizons.find((h) => h.horizon === "3m");
    const h6 = a.horizons.find((h) => h.horizon === "6m");
    return {
      ticker: a.ticker,
      name: a.snapshot?.name ?? a.ticker,
      industry: a.snapshot?.industry ?? a.snapshot?.sector ?? null,
      price: a.snapshot?.price ?? null,
      action,
      reason,
      conf1m: h1?.confidence ?? null,
      dir1m: h1?.direction ?? null,
      conf3m: h3?.confidence ?? null,
      dir3m: h3?.direction ?? null,
      conf6m: h6?.confidence ?? null,
      dir6m: h6?.direction ?? null,
      score1m: h1?.score ?? null,
      expected1m: h1?.expectedReturn ?? null,
      ciLow1m: h1?.ciLow ?? null,
      ciHigh1m: h1?.ciHigh ?? null,
      expected3m: h3?.expectedReturn ?? null,
      ciLow3m: h3?.ciLow ?? null,
      ciHigh3m: h3?.ciHigh ?? null,
      expected6m: h6?.expectedReturn ?? null,
      ciLow6m: h6?.ciLow ?? null,
      ciHigh6m: h6?.ciHigh ?? null,
      liquidityFlag: a.risk.liquidityFlag,
      riskNote: a.risk.riskNotes[0] ?? "",
      error: a.error,
    };
  });

  const summary = {
    buy: rows.filter((r) => r.action === "Buy").length,
    hold: rows.filter((r) => r.action === "Hold").length,
    sell: rows.filter((r) => r.action === "Sell").length,
    failed: rows.filter((r) => r.error).length,
  };

  return {
    asOf: new Date().toISOString(),
    universe,
    rows,
    summary,
    notes: [
      `Reviewed ${universe.length} on-site listed symbols (Quick pick list).`,
      "Action is educational: Buy = measured add bias, Hold = keep / wait, Sell = reduce exposure bias.",
      "Sell is favored when 1-month (and often 3-month) lean down. Buy requires confirmation — default is Hold when unsure.",
      "Not personalized advice. Position size and taxes depend on your situation.",
    ],
    disclaimer: DISCLAIMER,
  };
}
