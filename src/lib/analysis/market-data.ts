import { buildEventCalendar, EMPTY_CALENDAR, type EventCalendar } from "./calendar";
import {
  beta,
  last,
  maxDrawdown,
  periodReturn,
  realizedVol,
  returnsFromCloses,
  rsi,
  sma,
  zscore,
} from "./indicators";
import { cached, TTL } from "./cache";
import { fetchJson } from "./http";
import { buildQualityFromFund } from "./quality";
import {
  emptySocialBundle,
  fetchSocialSentimentBundle,
  type SocialSentimentBundle,
} from "./social";
import type {
  GovernanceBundle,
  MarketSnapshot,
  QualityBundle,
  SentimentBundle,
  SocialSentimentView,
} from "./types";

const YAHOO_UA =
  "Mozilla/5.0 (compatible; HorizonResearch/1.0; +https://example.local/research)";
const SEC_UA = "HorizonResearch/1.0 research@example.com";

export interface BarSeries {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  high52: number | null;
  low52: number | null;
  volume: number | null;
  closes: number[];
  volumes: number[];
  timestamps: number[];
}

export interface SearchMeta {
  name: string;
  sector: string | null;
  industry: string | null;
}

export interface Fundamentals {
  marketCap: number | null;
  peApprox: number | null;
  pbApprox: number | null;
  roe: number | null;
  revGrowthYoy: number | null;
  niGrowthYoy: number | null;
  shares: number | null;
  ni: number | null;
  ocf: number | null;
  rdExpense: number | null;
  capex: number | null;
  dividendYield: number | null;
  debtEquity: number | null;
  profitMargin: number | null;
  notes: string[];
}

type CompanyFacts = {
  entityName?: string;
  facts?: {
    "us-gaap"?: Record<string, { units?: Record<string, Array<Record<string, unknown>>> }>;
    "ifrs-full"?: Record<string, { units?: Record<string, Array<Record<string, unknown>>> }>;
  };
};

async function loadCikMap(): Promise<Map<string, number>> {
  return cached(
    "cik-map",
    TTL.cikMap,
    async () => {
      const map = new Map<string, number>();
      const data = await fetchJson<
        Record<string, { cik_str: number; ticker: string; title: string }>
      >("https://www.sec.gov/files/company_tickers.json", {
        "User-Agent": SEC_UA,
        Accept: "application/json",
      });
      if (!data) return map;
      for (const row of Object.values(data)) {
        if (row?.ticker) map.set(String(row.ticker).toUpperCase(), row.cik_str);
      }
      return map;
    },
    { persist: (map) => map.size > 0, missTtlMs: 20_000 },
  );
}

export async function resolveCik(ticker: string): Promise<number | null> {
  const map = await loadCikMap();
  return map.get(ticker.toUpperCase()) ?? null;
}

function parseChart(
  symbol: string,
  data: {
    chart?: {
      result?: Array<{
        meta?: Record<string, unknown>;
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
          adjclose?: Array<{ adjclose?: Array<number | null> }>;
        };
      }>;
    };
  } | null,
): BarSeries | null {
  const result = data?.chart?.result?.[0];
  if (!result?.meta || !result.timestamp?.length) return null;

  const meta = result.meta;
  const quote = result.indicators?.quote?.[0];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const rawCloses = adj ?? quote?.close ?? [];
  const rawVols = quote?.volume ?? [];

  const closes: number[] = [];
  const volumes: number[] = [];
  const timestamps: number[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const c = rawCloses[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    closes.push(c);
    volumes.push(rawVols[i] ?? 0);
    timestamps.push(result.timestamp[i]!);
  }
  if (closes.length < 15) return null;

  const price =
    typeof meta.regularMarketPrice === "number"
      ? meta.regularMarketPrice
      : last(closes)!;

  return {
    symbol: String(meta.symbol ?? symbol).toUpperCase(),
    name: String(meta.longName ?? meta.shortName ?? symbol),
    currency: String(meta.currency ?? "USD"),
    price,
    high52: typeof meta.fiftyTwoWeekHigh === "number" ? meta.fiftyTwoWeekHigh : null,
    low52: typeof meta.fiftyTwoWeekLow === "number" ? meta.fiftyTwoWeekLow : null,
    volume: typeof meta.regularMarketVolume === "number" ? meta.regularMarketVolume : null,
    closes,
    volumes,
    timestamps,
  };
}

export async function fetchChart(symbol: string, range = "1y"): Promise<BarSeries | null> {
  const key = `chart:${symbol.toUpperCase()}:${range}`;
  const ttl = range === "1y" || range === "6mo" || range === "3mo" ? TTL.chart : TTL.chartLong;
  return cached(
    key,
    ttl,
    async () => {
      const enc = encodeURIComponent(symbol);
      const path = `/v8/finance/chart/${enc}?interval=1d&range=${range}&includeAdjustedClose=true`;
      const data = await fetchJson<{
        chart?: {
          result?: Array<{
            meta?: Record<string, unknown>;
            timestamp?: number[];
            indicators?: {
              quote?: Array<{
                close?: Array<number | null>;
                volume?: Array<number | null>;
              }>;
              adjclose?: Array<{ adjclose?: Array<number | null> }>;
            };
          }>;
        };
      }>(
        [
          `https://query1.finance.yahoo.com${path}`,
          `https://query2.finance.yahoo.com${path}`,
        ],
        { "User-Agent": YAHOO_UA, Accept: "application/json" },
      );
      return parseChart(symbol, data);
    },
    { persist: (bar) => bar != null, missTtlMs: 8_000 },
  );
}

export async function prefetchMacro(range = "1y"): Promise<{
  spy: BarSeries | null;
  vix: BarSeries | null;
  tnx: BarSeries | null;
  uup: BarSeries | null;
  hyg: BarSeries | null;
}> {
  const spyRange = range;
  const [spy, vix, tnx, uup, hyg] = await Promise.all([
    fetchChart("SPY", spyRange),
    fetchChart("^VIX", spyRange),
    fetchChart("^TNX", spyRange),
    fetchChart("UUP", spyRange),
    fetchChart("HYG", spyRange),
  ]);
  return { spy, vix, tnx, uup, hyg };
}

export async function fetchSearchMeta(symbol: string): Promise<SearchMeta> {
  const sym = symbol.toUpperCase();
  return cached(`meta:${sym}`, TTL.meta, async () => {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=6&newsCount=0`;
    const data = await fetchJson<{
      quotes?: Array<{
        symbol?: string;
        shortname?: string;
        longname?: string;
        sector?: string;
        industry?: string;
      }>;
    }>(url, { "User-Agent": YAHOO_UA, Accept: "application/json" });

    const hit =
      data?.quotes?.find((q) => q.symbol?.toUpperCase() === sym) ?? data?.quotes?.[0];
    return {
      name: hit?.longname ?? hit?.shortname ?? symbol,
      sector: hit?.sector ?? null,
      industry: hit?.industry ?? null,
    };
  });
}

const BULL =
  /\b(surge|soar|beat|record|growth|upgrade|bull|outperform|strong|rally|breakout|accelerate|expand|win|boom|buy)\b/i;
const BEAR =
  /\b(fall|drop|miss|cut|downgrade|bear|lawsuit|probe|weak|slump|crash|warning|fraud|layoff|ban|risk|trap|sell)\b/i;

export async function fetchNewsSentiment(symbol: string): Promise<SentimentBundle> {
  const sym = symbol.toUpperCase();
  return cached(
    `news:${sym}`,
    TTL.news,
    async () => {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=12&quotesCount=1`;
      const data = await fetchJson<{
        news?: Array<{ title?: string; providerPublishTime?: number }>;
      }>(url, { "User-Agent": YAHOO_UA, Accept: "application/json" });

      const failed = data == null;
      const news = data?.news ?? [];
      let score = 0;
      let n = 0;
      const headlines: string[] = [];
      for (const item of news) {
        const title = item.title ?? "";
        if (!title) continue;
        headlines.push(title);
        let s = 0;
        if (BULL.test(title)) s += 1;
        if (BEAR.test(title)) s -= 1;
        score += s;
        n += 1;
      }
      const sentimentScore = n ? Math.max(-1, Math.min(1, score / Math.max(3, n * 0.6))) : 0;
      return {
        newsCount: n,
        sentimentScore,
        headlines: headlines.slice(0, 5),
        asOf: new Date().toISOString(),
        _failed: failed,
      } as SentimentBundle & { _failed: boolean };
    },
    { persist: (v) => !(v as SentimentBundle & { _failed?: boolean })._failed, missTtlMs: 8_000 },
  ).then((v) => {
    const { _failed, ...rest } = v as SentimentBundle & { _failed?: boolean };
    void _failed;
    return rest;
  });
}

function padCik(cik: number): string {
  return String(cik).padStart(10, "0");
}

export async function fetchGovernance(ticker: string): Promise<GovernanceBundle> {
  const sym = ticker.toUpperCase();
  return cached(`gov:${sym}`, TTL.governance, async () => {
    const empty: GovernanceBundle = {
      form4Count90d: null,
      form4Count180d: null,
      insiderSignal: 0,
      notes: [],
    };
    try {
      const cik = await resolveCik(ticker);
      if (!cik) {
        empty.notes.push("No CIK — insider module skipped (ETF/foreign common)");
        return empty;
      }
      const data = await fetchJson<{
        filings?: {
          recent?: {
            form?: string[];
            filingDate?: string[];
          };
        };
      }>(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`, {
        "User-Agent": SEC_UA,
        Accept: "application/json",
      });

      const forms = data?.filings?.recent?.form ?? [];
      const dates = data?.filings?.recent?.filingDate ?? [];
      const now = Date.now();
      const d90 = now - 90 * 86400000;
      const d180 = now - 180 * 86400000;
      let c90 = 0;
      let c180 = 0;
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] !== "4") continue;
        const fd = dates[i] ? Date.parse(dates[i]!) : NaN;
        if (!Number.isFinite(fd)) continue;
        if (fd >= d180) c180++;
        if (fd >= d90) c90++;
      }
      let signal = 0;
      if (c90 >= 20) {
        signal = -0.25;
        empty.notes.push(`Heavy Form 4 cluster (${c90} in 90d) — possible distribution`);
      } else if (c90 >= 5) {
        signal = 0.08;
        empty.notes.push(`${c90} Form 4 filings in 90d — active insider reporting`);
      } else if (c90 === 0) {
        signal = 0;
        empty.notes.push("No Form 4 in 90d");
      } else {
        signal = 0.05;
        empty.notes.push(`${c90} Form 4 in 90d`);
      }
      empty.form4Count90d = c90;
      empty.form4Count180d = c180;
      empty.insiderSignal = signal;
      empty.notes.push(`${c180} Form 4 in 180d`);
      return empty;
    } catch {
      empty.notes.push("Insider fetch failed");
      return empty;
    }
  });
}

type FactRow = {
  end: string;
  val: number;
  form?: string;
  fy?: number;
  fp?: string;
  start?: string;
  filed?: string;
};

function pickLatestFacts(
  units: Record<string, Array<Record<string, unknown>>> | undefined,
  asOfIso?: string,
  preferForms = ["10-K", "10-Q", "20-F", "6-K"],
): FactRow[] {
  if (!units) return [];
  const preferredUnit =
    units.USD ??
    units["USD/shares"] ??
    units.shares ??
    units.pure ??
    Object.values(units)[0];
  if (!preferredUnit?.length) return [];
  const asOfMs = asOfIso ? Date.parse(asOfIso) : null;
  const filtered = preferredUnit
    .filter((x) => typeof x.val === "number" && typeof x.end === "string")
    .map((x) => ({
      end: String(x.end),
      val: Number(x.val),
      form: x.form ? String(x.form) : undefined,
      fy: typeof x.fy === "number" ? x.fy : undefined,
      fp: x.fp ? String(x.fp) : undefined,
      start: x.start ? String(x.start) : undefined,
      filed: x.filed ? String(x.filed) : undefined,
    }))
    .filter((x) => !x.form || preferForms.some((f) => x.form!.includes(f)))
    .filter((x) => {
      if (asOfMs == null) return true;
      if (x.filed) {
        const f = Date.parse(x.filed);
        if (Number.isFinite(f) && f > asOfMs) return false;
      }
      return true;
    });
  return filtered.sort((a, b) => (a.end < b.end ? 1 : -1));
}

function yoyGrowth(series: FactRow[]): number | null {
  if (series.length < 2) return null;
  const latest = series[0]!;
  const target = new Date(latest.end);
  target.setFullYear(target.getFullYear() - 1);
  const targetMs = target.getTime();
  let best: FactRow | null = null;
  let bestDiff = Infinity;
  for (const row of series.slice(1, 40)) {
    const d = Math.abs(new Date(row.end).getTime() - targetMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = row;
    }
  }
  if (!best || best.val === 0) return null;
  if (bestDiff > 1000 * 60 * 60 * 24 * 120) return null;
  return latest.val / best.val - 1;
}

async function loadCompanyFacts(cik: number): Promise<CompanyFacts | null> {
  return cached(
    `facts:${cik}`,
    TTL.companyfacts,
    async () => {
      const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`;
      return fetchJson<CompanyFacts>(url, {
        "User-Agent": SEC_UA,
        Accept: "application/json",
      });
    },
    { persist: (facts) => facts != null, missTtlMs: 15_000 },
  );
}

export async function fetchFundamentals(
  ticker: string,
  price: number,
  asOfIso?: string,
): Promise<Fundamentals> {
  const empty: Fundamentals = {
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
    notes: [],
  };
  try {
    const cik = await resolveCik(ticker);
    if (!cik) {
      empty.notes.push("No SEC CIK mapping — fundamentals module limited");
      return empty;
    }
    const data = await loadCompanyFacts(cik);
    if (!data) {
      empty.notes.push("Companyfacts unavailable");
      return empty;
    }

    const gaap = data.facts?.["us-gaap"] ?? {};
    const ifrs = data.facts?.["ifrs-full"] ?? {};

    const pickSeries = (keys: string[]) => {
      for (const k of keys) {
        const node = gaap[k] ?? ifrs[k];
        if (node?.units) {
          const s = pickLatestFacts(node.units, asOfIso);
          if (s.length) return s;
        }
      }
      return [] as FactRow[];
    };

    const rev = pickSeries([
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "SalesRevenueNet",
      "Revenue",
    ]);
    const ni = pickSeries(["NetIncomeLoss", "ProfitLoss"]);
    const equity = pickSeries([
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
      "Equity",
    ]);
    const assets = pickSeries(["Assets"]);
    const shares = pickSeries([
      "CommonStockSharesOutstanding",
      "WeightedAverageNumberOfSharesOutstandingBasic",
      "EntityCommonStockSharesOutstanding",
    ]);
    const ocf = pickSeries([
      "NetCashProvidedByUsedInOperatingActivities",
      "CashGeneratedFromOperations",
    ]);
    const rd = pickSeries(["ResearchAndDevelopmentExpense"]);
    const capex = pickSeries([
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PurchaseOfPropertyPlantAndEquipment",
    ]);

    const latestNi = ni[0]?.val ?? null;
    const latestShares = shares[0]?.val ?? null;
    const latestEquity = equity[0]?.val ?? null;
    const latestOcf = ocf[0]?.val ?? null;
    const latestRd = rd[0]?.val ?? null;
    const latestCapex = capex[0]?.val ?? null;

    const revGrowthYoy = yoyGrowth(rev);
    const niGrowthYoy = yoyGrowth(ni);
    const roe =
      latestNi != null && latestEquity != null && latestEquity !== 0
        ? latestNi / latestEquity
        : null;

    let peApprox: number | null = null;
    if (price > 0 && latestNi != null && latestShares != null && latestShares > 0) {
      const eps = latestNi / latestShares;
      if (eps > 0) peApprox = price / eps;
    }

    let pbApprox: number | null = null;
    if (price > 0 && latestEquity != null && latestShares != null && latestShares > 0) {
      const bv = latestEquity / latestShares;
      if (bv > 0) pbApprox = price / bv;
    }

    const marketCap =
      latestShares != null && latestShares > 0 && price > 0 ? latestShares * price : null;

    const notes: string[] = [];
    if (asOfIso) notes.push(`Fundamentals point-in-time as of ${asOfIso.slice(0, 10)}`);
    if (rev[0]) notes.push(`Revenue period ended ${rev[0].end}`);
    if (latestNi != null) notes.push("Net income from latest filing");
    if (peApprox == null) notes.push("P/E approximate unavailable");
    if (!rev.length) notes.push("Revenue series incomplete");

    return {
      marketCap,
      peApprox,
      pbApprox,
      roe,
      revGrowthYoy,
      niGrowthYoy,
      shares: latestShares,
      ni: latestNi,
      ocf: latestOcf,
      rdExpense: latestRd,
      capex: latestCapex,
      dividendYield: null,
      debtEquity: null,
      profitMargin: null,
      notes,
    };
  } catch {
    empty.notes.push("Fundamentals fetch failed");
    return empty;
  }
}

async function fetchQuoteStats(ticker: string): Promise<{
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  debtEquity: number | null;
  profitMargin: number | null;
  epsGrowth: number | null;
  roe: number | null;
}> {
  const sym = ticker.toUpperCase();
  return cached(`qstats:${sym}`, TTL.meta, async () => {
    const data = await fetchJson<{
      quoteResponse?: {
        result?: Array<{
          trailingPE?: number;
          priceToBook?: number;
          trailingAnnualDividendYield?: number;
          dividendYield?: number;
          profitMargins?: number;
          returnOnEquity?: number;
          earningsGrowth?: number;
          debtToEquity?: number;
        }>;
      };
    }>(
      [
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=trailingPE,priceToBook,trailingAnnualDividendYield,dividendYield,profitMargins,returnOnEquity,earningsGrowth,debtToEquity`,
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=trailingPE,priceToBook,trailingAnnualDividendYield,dividendYield,profitMargins,returnOnEquity,earningsGrowth,debtToEquity`,
      ],
      { "User-Agent": YAHOO_UA, Accept: "application/json" },
    );
    const q = data?.quoteResponse?.result?.[0];
    const dy = q?.trailingAnnualDividendYield ?? q?.dividendYield ?? null;
    return {
      pe: typeof q?.trailingPE === "number" ? q.trailingPE : null,
      pb: typeof q?.priceToBook === "number" ? q.priceToBook : null,
      dividendYield: typeof dy === "number" ? (dy > 1 ? dy / 100 : dy) : null,
      debtEquity: typeof q?.debtToEquity === "number" ? q.debtToEquity / 100 : null,
      profitMargin: typeof q?.profitMargins === "number" ? q.profitMargins : null,
      epsGrowth: typeof q?.earningsGrowth === "number" ? q.earningsGrowth : null,
      roe: typeof q?.returnOnEquity === "number" ? q.returnOnEquity : null,
    };
  });
}

function buildQuality(fund: Fundamentals): QualityBundle {
  return buildQualityFromFund(fund);
}

const COMMODITY_TICKERS = new Set([
  "IAU",
  "SLV",
  "PLTM",
  "GLD",
  "GDX",
  "GDXJ",
  "USO",
  "UNG",
  "DBC",
  "PPLT",
  "SIVR",
  "SGOL",
]);

const AI_KEYWORDS = [
  "semiconductor",
  "software",
  "artificial intelligence",
  "internet",
  "cloud",
  "information technology",
];

function isAiHighGrowth(
  ticker: string,
  sector: string | null,
  industry: string | null,
  name: string,
): boolean {
  const known = new Set([
    "NVDA",
    "AVGO",
    "TSM",
    "AMD",
    "SMCI",
    "ARM",
    "ASML",
    "AMAT",
    "LRCX",
    "KLAC",
    "PLTR",
    "SNOW",
    "MSFT",
    "GOOGL",
    "GOOG",
    "AMZN",
    "META",
    "CRM",
    "NOW",
    "AI",
    "PATH",
    "MU",
    "SMH",
    "QQQ",
    "SOXX",
  ]);
  if (known.has(ticker.toUpperCase())) return true;
  const blob = `${sector ?? ""} ${industry ?? ""} ${name}`.toLowerCase();
  return AI_KEYWORDS.some((k) => blob.includes(k));
}

export function isCommodityLike(
  ticker: string,
  sector: string | null,
  industry: string | null,
  name: string,
): boolean {
  if (COMMODITY_TICKERS.has(ticker.toUpperCase())) return true;
  const blob = `${sector ?? ""} ${industry ?? ""} ${name}`.toLowerCase();
  return /gold|silver|platinum|precious metal|commodity|crude|oil|natural gas|miner/.test(
    blob,
  );
}

function toSocialView(s: SocialSentimentBundle): SocialSentimentView {
  const map = (c: SocialSentimentBundle["stocktwits"]) => ({
    source: c.source,
    sampleCount: c.sampleCount,
    bullish: c.bullish,
    bearish: c.bearish,
    score: c.score,
    samples: c.samples,
    notes: c.notes,
  });
  return {
    stocktwits: map(s.stocktwits),
    reddit: map(s.reddit),
    political: map(s.political),
    x: map(s.x ?? emptySocialBundle().x),
    money: map(s.money ?? emptySocialBundle().money),
    blendedScore: s.blendedScore,
    blendedConfidence: s.blendedConfidence,
    asOf: s.asOf,
  };
}

export interface RawBundle {
  bar: BarSeries;
  spy: BarSeries | null;
  vix: BarSeries | null;
  tnx: BarSeries | null;
  uup: BarSeries | null;
  hyg: BarSeries | null;
  meta: SearchMeta;
  fundamentals: Fundamentals;
  sentiment: SentimentBundle;
  social: SocialSentimentBundle;
  governance: GovernanceBundle;
  quality: QualityBundle;
  calendar: EventCalendar;
  competitorRel21: number | null;
  competitorNotes: string[];
}

export type MacroBundle = {
  spy?: BarSeries | null;
  vix?: BarSeries | null;
  tnx?: BarSeries | null;
  uup?: BarSeries | null;
  hyg?: BarSeries | null;
};

const COMPETITORS: Record<string, string[]> = {
  NVDA: ["AMD", "AVGO", "TSM"],
  AMD: ["NVDA", "AVGO", "TSM"],
  AVGO: ["NVDA", "TSM", "QCOM"],
  TSM: ["NVDA", "ASML", "AMAT"],
  ASML: ["AMAT", "LRCX", "KLAC"],
  AMAT: ["LRCX", "KLAC", "ASML"],
  LRCX: ["AMAT", "KLAC", "ASML"],
  KLAC: ["AMAT", "LRCX", "ASML"],
  MU: ["000660.KS", "AMD", "NVDA"],
  "000660.KS": ["MU", "NVDA", "AMD"],
  TSLA: ["F", "GM", "RIVN"],
  AAPL: ["MSFT", "GOOG", "AMZN"],
  MSFT: ["GOOG", "AAPL", "AMZN"],
  GOOG: ["MSFT", "META", "AMZN"],
  AMZN: ["MSFT", "GOOG", "WMT"],
  META: ["GOOG", "AMZN", "SNAP"],
  QQQ: ["SPY", "IWM", "DIA"],
  SMH: ["SOXX", "NVDA", "TSM"],
  RCL: ["CCL", "NCLH"],
  FTNT: ["PANW", "CRWD"],
};

async function competitorTape(
  ticker: string,
  own21: number | null,
  light: boolean,
): Promise<{ rel21: number | null; notes: string[] }> {
  const peers = COMPETITORS[ticker.toUpperCase()] ?? [];
  if (!peers.length || own21 == null) {
    return { rel21: null, notes: ["No named competitors mapped for this ticker"] };
  }
  if (light) {
    return { rel21: null, notes: ["Competitor check runs on the full pass"] };
  }
  const rets: Array<{ t: string; r: number }> = [];
  await Promise.all(
    peers.slice(0, 3).map(async (p) => {
      const b = await fetchChart(p, "1y");
      if (!b) return;
      const r = periodReturn(b.closes, 21);
      if (r != null) rets.push({ t: p, r });
    }),
  );
  if (!rets.length) return { rel21: null, notes: ["Competitor prices unavailable"] };
  const avg = rets.reduce((s, x) => s + x.r, 0) / rets.length;
  const rel21 = own21 - avg;
  const notes = [
    `Vs ${rets.map((x) => x.t).join(", ")} last month: ${rel21 >= 0 ? "ahead" : "behind"} by ${Math.abs(rel21 * 100).toFixed(1)} pts`,
  ];
  return { rel21, notes };
}

export async function fetchRawBundle(
  ticker: string,
  opts?: {
    asOfIso?: string;
    chartRange?: string;
    spy?: BarSeries | null;
    vix?: BarSeries | null;
    tnx?: BarSeries | null;
    uup?: BarSeries | null;
    hyg?: BarSeries | null;
    light?: boolean;
  },
): Promise<RawBundle | null> {
  const range = opts?.chartRange ?? "2y";
  const spyRange = range;
  const light = opts?.light === true;

  const [bar, spy, vix, tnx, uup, hyg, meta, sentiment, governance, social] = await Promise.all([
    fetchChart(ticker, range),
    opts?.spy !== undefined ? Promise.resolve(opts.spy) : fetchChart("SPY", spyRange),
    opts?.vix !== undefined ? Promise.resolve(opts.vix) : fetchChart("^VIX", spyRange),
    opts?.tnx !== undefined ? Promise.resolve(opts.tnx) : fetchChart("^TNX", spyRange),
    opts?.uup !== undefined ? Promise.resolve(opts.uup) : fetchChart("UUP", spyRange),
    opts?.hyg !== undefined ? Promise.resolve(opts.hyg) : fetchChart("HYG", spyRange),
    light
      ? Promise.resolve({ name: "", sector: null, industry: null } as SearchMeta)
      : fetchSearchMeta(ticker),
    light
      ? Promise.resolve({
          newsCount: 0,
          sentimentScore: 0,
          headlines: [] as string[],
          asOf: "",
        })
      : fetchNewsSentiment(ticker),
    light
      ? Promise.resolve({
          form4Count90d: null as number | null,
          form4Count180d: null as number | null,
          insiderSignal: 0,
          notes: ["Light scan — price and market tape only"],
        })
      : fetchGovernance(ticker),
    light ? Promise.resolve(emptySocialBundle()) : fetchSocialSentimentBundle(ticker, null),
  ]);
  if (!bar) return null;

  const fundamentals = light
    ? {
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
        notes: ["Light scan — skipped SEC for speed"],
      }
    : await fetchFundamentals(ticker, bar.price, opts?.asOfIso);
  if (!light) {
    const qs = await fetchQuoteStats(ticker);
    if (fundamentals.peApprox == null && qs.pe != null) fundamentals.peApprox = qs.pe;
    if (fundamentals.pbApprox == null && qs.pb != null) fundamentals.pbApprox = qs.pb;
    if (fundamentals.roe == null && qs.roe != null) fundamentals.roe = qs.roe;
    fundamentals.dividendYield = qs.dividendYield;
    fundamentals.debtEquity = qs.debtEquity;
    fundamentals.profitMargin = qs.profitMargin;
    if (qs.epsGrowth != null && fundamentals.niGrowthYoy == null) {
      fundamentals.niGrowthYoy = qs.epsGrowth;
    }
  }
  const quality = buildQuality(fundamentals);

  let socialFinal = social;
  if (!light) {
    const name = meta.name || bar.name;
    if (name && name.toUpperCase() !== ticker.toUpperCase() && social.reddit.sampleCount < 2) {
      socialFinal = await fetchSocialSentimentBundle(ticker, name);
    }
  }

  const own21 = periodReturn(bar.closes, 21);
  const [calendar, competitors] = await Promise.all([
    light ? Promise.resolve(EMPTY_CALENDAR) : buildEventCalendar(ticker),
    competitorTape(ticker, own21, light),
  ]);

  return {
    bar,
    spy,
    vix,
    tnx,
    uup,
    hyg,
    meta: {
      ...meta,
      name:
        [meta.name, bar.name].find(
          (n) => n && n.toUpperCase() !== ticker.toUpperCase(),
        ) ||
        bar.name ||
        ticker.toUpperCase(),
    },
    fundamentals,
    sentiment,
    social: socialFinal,
    governance,
    quality,
    calendar,
    competitorRel21: competitors.rel21,
    competitorNotes: competitors.notes,
  };
}

export function buildSnapshot(ticker: string, raw: RawBundle): MarketSnapshot {
  const { bar, spy, meta, fundamentals } = raw;
  const closes = bar.closes;
  const vols = bar.volumes;
  const rets = returnsFromCloses(closes);

  const ret5d = periodReturn(closes, 5);
  const ret21d = periodReturn(closes, 21);
  const ret63d = periodReturn(closes, 63);
  const ret126d = periodReturn(closes, 126);

  const spy21 = spy ? periodReturn(spy.closes, 21) : null;
  const spy63 = spy ? periodReturn(spy.closes, 63) : null;
  const spy126 = spy ? periodReturn(spy.closes, 126) : null;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const price = bar.price;

  const high52 = bar.high52 ?? Math.max(...closes);
  const low52 = bar.low52 ?? Math.min(...closes);
  const range = high52 - low52;
  const range52wPos = range > 0 ? (price - low52) / range : null;

  const lastVol = last(vols) ?? 0;
  const volWindow = vols.slice(-20);
  const volumeZ20 = volWindow.length >= 10 ? zscore(lastVol, volWindow) : null;

  const name = meta.name || bar.name;
  const sector = meta.sector;
  const industry = meta.industry;

  const dataQuality: string[] = [];
  dataQuality.push(`Price series: ${closes.length} daily bars`);
  if (!fundamentals.marketCap) dataQuality.push("Market cap incomplete");
  if (fundamentals.peApprox == null) dataQuality.push("P/E approximate unavailable");
  if (raw.sentiment.newsCount === 0) dataQuality.push("No recent headlines");
  if (raw.social.stocktwits.sampleCount === 0) dataQuality.push("StockTwits empty");
  if (raw.social.reddit.sampleCount === 0) dataQuality.push("Reddit proxy empty");
  for (const n of fundamentals.notes) dataQuality.push(n);

  return {
    ticker: ticker.toUpperCase(),
    name,
    sector,
    industry,
    price,
    currency: bar.currency,
    change1d: rets.length ? last(rets)! : null,
    ret5d,
    ret21d,
    ret63d,
    ret126d,
    relSpy21d: ret21d != null && spy21 != null ? ret21d - spy21 : null,
    relSpy63d: ret63d != null && spy63 != null ? ret63d - spy63 : null,
    relSpy126d: ret126d != null && spy126 != null ? ret126d - spy126 : null,
    rsi14: rsi(closes, 14),
    sma20,
    sma50,
    sma200,
    aboveSma50: sma50 != null ? price > sma50 : null,
    aboveSma200: sma200 != null ? price > sma200 : null,
    dist52wHigh: high52 > 0 ? price / high52 - 1 : null,
    dist52wLow: low52 > 0 ? price / low52 - 1 : null,
    range52wPos,
    volumeZ20,
    marketCap: fundamentals.marketCap,
    peApprox: fundamentals.peApprox,
    pbApprox: fundamentals.pbApprox,
    roe: fundamentals.roe,
    revGrowthYoy: fundamentals.revGrowthYoy,
    niGrowthYoy: fundamentals.niGrowthYoy,
    dividendYield: fundamentals.dividendYield ?? null,
    debtEquity: fundamentals.debtEquity ?? null,
    profitMargin: fundamentals.profitMargin ?? null,
    isAiHighGrowth: isAiHighGrowth(ticker, sector, industry, name),
    isCommodityLike: isCommodityLike(ticker, sector, industry, name),
    daysToEarnings: raw.calendar?.daysToEarnings ?? null,
    daysToFed: raw.calendar?.daysToFed ?? null,
    daysToCpi: raw.calendar?.daysToCpi ?? null,
    nextEvent: raw.calendar?.nextEvent ?? null,
    calendarNotes: raw.calendar?.notes ?? [],
    competitorRel21: raw.competitorRel21 ?? null,
    competitorNotes: raw.competitorNotes ?? [],
    sentiment: raw.sentiment,
    social: toSocialView(raw.social ?? emptySocialBundle()),
    governance: raw.governance,
    quality: raw.quality,
    asOf: new Date().toISOString(),
    dataQuality,
  };
}

export function getSeriesHelpers(raw: RawBundle) {
  const closes = raw.bar.closes;
  const vols = raw.bar.volumes;
  const rets = returnsFromCloses(closes);
  const spyRets = raw.spy ? returnsFromCloses(raw.spy.closes) : [];
  const n = Math.min(rets.length, spyRets.length || rets.length);
  return {
    closes,
    vols,
    rets,
    spyRets: spyRets.slice(-n),
    assetRetsAligned: rets.slice(-n),
    vol21: realizedVol(rets, 21),
    vol63: realizedVol(rets, 63),
    mdd: maxDrawdown(closes.slice(-126)),
    betaSpy: spyRets.length ? beta(rets, spyRets) : null,
    vixLevel: raw.vix ? last(raw.vix.closes) ?? null : null,
    vixTrend:
      raw.vix && raw.vix.closes.length > 21
        ? last(raw.vix.closes)! / raw.vix.closes[raw.vix.closes.length - 22]! - 1
        : null,
    spyTrend63: raw.spy ? periodReturn(raw.spy.closes, 63) : null,
    spyTrend21: raw.spy ? periodReturn(raw.spy.closes, 21) : null,
    tnxChg21:
      raw.tnx && raw.tnx.closes.length > 21
        ? last(raw.tnx.closes)! - raw.tnx.closes[raw.tnx.closes.length - 22]!
        : null,
    uupRet21: raw.uup ? periodReturn(raw.uup.closes, 21) : null,
    hygRet21: raw.hyg ? periodReturn(raw.hyg.closes, 21) : null,
    avgDollarVol: (() => {
      const window = Math.min(20, closes.length, vols.length);
      if (!window) return null;
      let sum = 0;
      for (let i = 0; i < window; i++) {
        const idx = closes.length - 1 - i;
        sum += closes[idx]! * (vols[idx] ?? 0);
      }
      return sum / window;
    })(),
  };
}

export function estimateFrictionBps(avgDollarVol: number | null): number {
  if (avgDollarVol == null) return 18;
  if (avgDollarVol > 200_000_000) return 4;
  if (avgDollarVol > 50_000_000) return 8;
  if (avgDollarVol > 10_000_000) return 14;
  if (avgDollarVol > 2_000_000) return 25;
  return 45;
}
