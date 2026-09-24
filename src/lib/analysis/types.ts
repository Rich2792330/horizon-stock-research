export type Direction = "Increase" | "Decrease" | "Neutral";

export type Horizon = "1m" | "3m" | "6m";

export type ModuleId =
  | "fundamentals"
  | "valuation"
  | "earnings"
  | "macro"
  | "industry"
  | "momentum"
  | "reversal"
  | "positioning"
  | "sentiment"
  | "social"
  | "political"
  | "governance"
  | "psychology"
  | "calendar"
  | "competitors"
  | "money"
  | "lowVol"
  | "otherFactors"
  | "risk";

export interface ModuleScore {
  id: ModuleId;
  label: string;
  score: number; // -1..+1 directional edge (risk module is informational)
  confidence: number; // 0..1 evidence strength
  notes: string[];
  halfLife: string;
}

export interface HorizonForecast {
  horizon: Horizon;
  label: string;
  direction: Direction;
  confidence: number; // 0-100
  score: number;
  abstain: boolean;
  abstainReason?: string;
  weights: Record<string, number>;
  drivers: string[];
  /** Estimated one-way friction (bps) considered when sizing confidence */
  frictionBps?: number;
  /** Anticipated simple return over the horizon (0.024 = +2.4%) */
  expectedReturn: number;
  /** Lower bound of the interval (decimal) */
  ciLow: number;
  /** Upper bound of the interval (decimal) */
  ciHigh: number;
  /** Interval coverage, e.g. 80 */
  ciLevel: number;
  /** Realized vol scaled to this horizon (decimal) */
  horizonVol: number;
  /** Plain-English reason when confidence is above 60 */
  whyConfident?: string;
}

export interface RiskView {
  realizedVol21d: number | null;
  realizedVol63d: number | null;
  betaSpy: number | null;
  maxDrawdown6m: number | null;
  avgDollarVolume: number | null;
  liquidityFlag: "high" | "medium" | "low" | "unknown";
  estimatedRoundTripBps: number | null;
  stressScenarios: string[];
  riskNotes: string[];
}

export interface SentimentBundle {
  newsCount: number;
  sentimentScore: number; // -1..+1
  headlines: string[];
  asOf: string;
}

export interface ChannelSentimentView {
  source: string;
  sampleCount: number;
  bullish: number;
  bearish: number;
  score: number;
  samples: string[];
  notes: string[];
}

export interface SocialSentimentView {
  stocktwits: ChannelSentimentView;
  reddit: ChannelSentimentView;
  political: ChannelSentimentView;
  x: ChannelSentimentView;
  money: ChannelSentimentView;
  blendedScore: number;
  blendedConfidence: number;
  asOf: string;
}

export interface GovernanceBundle {
  form4Count90d: number | null;
  form4Count180d: number | null;
  insiderSignal: number; // -1..+1
  notes: string[];
}

export interface QualityBundle {
  ocf: number | null;
  ni: number | null;
  accrualsProxy: number | null;
  rdExpense: number | null;
  capex: number | null;
  rdIntensity: number | null;
  notes: string[];
}

export interface MarketSnapshot {
  ticker: string;
  name: string;
  sector: string | null;
  industry: string | null;
  price: number;
  currency: string;
  change1d: number | null;
  ret5d: number | null;
  ret21d: number | null;
  ret63d: number | null;
  ret126d: number | null;
  relSpy21d: number | null;
  relSpy63d: number | null;
  relSpy126d: number | null;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  dist52wHigh: number | null;
  dist52wLow: number | null;
  range52wPos: number | null;
  volumeZ20: number | null;
  marketCap: number | null;
  peApprox: number | null;
  pbApprox: number | null;
  roe: number | null;
  revGrowthYoy: number | null;
  niGrowthYoy: number | null;
  dividendYield: number | null;
  debtEquity: number | null;
  profitMargin: number | null;
  isAiHighGrowth: boolean;
  isCommodityLike: boolean;
  daysToEarnings: number | null;
  daysToFed: number | null;
  daysToCpi: number | null;
  nextEvent: string | null;
  calendarNotes: string[];
  competitorRel21: number | null;
  competitorNotes: string[];
  sentiment: SentimentBundle | null;
  social: SocialSentimentView | null;
  governance: GovernanceBundle | null;
  quality: QualityBundle | null;
  asOf: string;
  dataQuality: string[];
}

export interface TickerAnalysis {
  ticker: string;
  snapshot: MarketSnapshot | null;
  modules: ModuleScore[];
  horizons: HorizonForecast[];
  risk: RiskView;
  keyDrivers: string;
  methodologyNote: string;
  quantScore?: number | null;
  quantRank?: number | null;
  quantRaw?: {
    momentum: number | null;
    value: number | null;
    quality: number | null;
    lowVol: number | null;
    other: number | null;
    notes: string[];
  };
  error?: string;
}

export interface AnalysisReport {
  asOf: string;
  tickers: string[];
  results: TickerAnalysis[];
  overallMethodology: string;
  keyRisks: string[];
  abstainNotes: string[];
  disclaimer: string;
  tape?: {
    label: "Bull tape" | "Bear tape" | "Choppy";
    reasons: string[];
    flipBack: string[];
    suppressRiseCalls: boolean;
    monthDown?: boolean;
    holdUp: { ticker: string; name: string }[];
    breakDown: { ticker: string; name: string }[];
  };
}
