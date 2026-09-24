import type { TickerAnalysis } from "./types";

/** Quick-pick / on-site listed symbols (Buy · Hold · Sell review) */
export const LISTED_STOCKS = [
  "QQQ",
  "RCL",
  "SMH",
  "NVDA",
  "TSM",
  "MSFT",
  "ASML",
  "AMAT",
  "KLAC",
  "MU",
  "000660.KS",
  "TSLA",
  "SPCX",
  "AAPL",
  "AMZN",
  "AVGO",
  "GOOG",
  "IAU",
  "SLV",
  "PLTM",
  "FTNT",
] as const;

export const TICKER_LABELS: Record<string, string> = {
  "000660.KS": "SK Hynix",
};

/** Fallback name + industry so the table always says what the ticker is. */
export const TICKER_PROFILE: Record<string, { name: string; industry: string }> = {
  QQQ: { name: "Invesco QQQ Trust", industry: "ETF · Nasdaq-100" },
  RCL: { name: "Royal Caribbean Group", industry: "Cruise lines" },
  SMH: { name: "VanEck Semiconductor ETF", industry: "ETF · semiconductors" },
  NVDA: { name: "NVIDIA", industry: "Semiconductors" },
  TSM: { name: "Taiwan Semiconductor", industry: "Semiconductors" },
  MSFT: { name: "Microsoft", industry: "Software" },
  ASML: { name: "ASML Holding", industry: "Chip equipment" },
  AMAT: { name: "Applied Materials", industry: "Chip equipment" },
  KLAC: { name: "KLA Corporation", industry: "Chip equipment" },
  MU: { name: "Micron Technology", industry: "Memory chips" },
  "000660.KS": { name: "SK Hynix", industry: "Memory chips" },
  TSLA: { name: "Tesla", industry: "Electric vehicles" },
  SPCX: { name: "SpaceX", industry: "Launch & satellite" },
  AAPL: { name: "Apple", industry: "Consumer electronics" },
  AMZN: { name: "Amazon", industry: "E-commerce & cloud" },
  AVGO: { name: "Broadcom", industry: "Semiconductors" },
  GOOG: { name: "Alphabet", industry: "Internet & advertising" },
  IAU: { name: "iShares Gold Trust", industry: "ETF · gold" },
  SLV: { name: "iShares Silver Trust", industry: "ETF · silver" },
  PLTM: { name: "GraniteShares Platinum Trust", industry: "ETF · platinum" },
  FTNT: { name: "Fortinet", industry: "Cybersecurity" },
};

export function displayTicker(ticker: string): string {
  return TICKER_LABELS[ticker] ?? ticker;
}

export function displayTickerHint(ticker: string): string | null {
  return TICKER_LABELS[ticker] ? ticker : null;
}

export function identityFor(
  ticker: string,
  snap?: { name?: string | null; industry?: string | null; sector?: string | null } | null,
): { name: string | null; industry: string | null } {
  const fb = TICKER_PROFILE[ticker];
  const rawName = snap?.name?.trim() || null;
  const looksLikeTicker =
    !rawName || rawName.toUpperCase() === ticker.toUpperCase() || rawName === displayTicker(ticker);
  const name = looksLikeTicker ? (fb?.name ?? rawName) : rawName;
  const industry = snap?.industry || snap?.sector || fb?.industry || null;
  return { name, industry };
}

/** Rank apples with apples: metals vs metals, semis vs semis. */
export function quantGroup(ticker: string, industry?: string | null, sector?: string | null): string {
  const ind = `${TICKER_PROFILE[ticker]?.industry ?? ""} ${industry ?? ""} ${sector ?? ""}`.toLowerCase();
  if (/gold|silver|platinum|precious/.test(ind)) return "metals";
  if (/semiconductor|chip|memory/.test(ind)) return "semis";
  if (/launch|satellite|aerospace|space/.test(ind)) return "space";
  if (ind.includes("etf")) return "etf";
  if (/software|internet|e-commerce|cloud|consumer electronics|advertising/.test(ind)) return "big-tech";
  if (/cyber/.test(ind)) return "cyber";
  if (/cruise|travel/.test(ind)) return "travel";
  if (/electric vehicle|auto/.test(ind)) return "auto";
  return "other";
}

/** Higher = more likely a next-month rise. Increase + high sure% first. */
export function riseSortScore(r: TickerAnalysis): number {
  if (r.error || !r.horizons.length) return -10_000;
  const h = r.horizons.find((x) => x.horizon === "1m");
  if (!h) return -10_000;
  const exp = h.expectedReturn ?? 0;
  if (h.direction === "Increase" && !h.abstain) {
    return 2_000 + h.confidence + exp * 80;
  }
  if (h.direction === "Decrease" && !h.abstain) {
    return h.confidence * 0.05 + exp * 80;
  }
  return 400 + exp * 80 + h.confidence * 0.2;
}

export function compareLikelyRise(a: TickerAnalysis, b: TickerAnalysis): number {
  return riseSortScore(b) - riseSortScore(a);
}

