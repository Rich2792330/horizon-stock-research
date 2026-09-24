/**
 * Free multi-source social + political sentiment.
 * - StockTwits: labeled retail social
 * - Google News RSS: Reddit, X/Twitter, political, and big-money headlines
 */

import { cached, TTL } from "./cache";
import { fetchJson, fetchText } from "./http";

const UA =
  "Mozilla/5.0 (compatible; HorizonResearch/1.0; +https://example.local/research)";

const BULL =
  /\b(surge|soar|beat|record|growth|upgrade|bull|bullish|outperform|strong|rally|breakout|accelerate|expand|win|boom|buy|long|moon|calls?|overweight|inflow)\b/i;
const BEAR =
  /\b(fall|drop|miss|cut|downgrade|bear|bearish|lawsuit|probe|weak|slump|crash|warning|fraud|layoff|ban|risk|trap|sell|short|puts?|tariff|restriction|underweight|outflow)\b/i;

const POLITICAL =
  /\b(trump|biden|harris|congress|senate|house|white\s*house|fcc|ftc|sec\b|doj|cftc|tariff|export\s*control|sanction|executive\s*order|regulation|legislat|china|beijing|xi\b|putin|eu\b|brussels|lutnick|yellen|powell|fed\b|treasury|chip\s*act|ira\b|geopolitic|election|policy|admin(?:istration)?)\b/i;

export interface ChannelSentiment {
  source: "stocktwits" | "reddit" | "political" | "news" | "x" | "money";
  sampleCount: number;
  bullish: number;
  bearish: number;
  neutral: number;
  score: number;
  confidence: number;
  samples: string[];
  notes: string[];
}

export interface SocialSentimentBundle {
  stocktwits: ChannelSentiment;
  reddit: ChannelSentiment;
  political: ChannelSentiment;
  x: ChannelSentiment;
  money: ChannelSentiment;
  blendedScore: number;
  blendedConfidence: number;
  asOf: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/'/g, "'");
}

function emptyChannel(
  source: ChannelSentiment["source"],
  note: string,
): ChannelSentiment {
  return {
    source,
    sampleCount: 0,
    bullish: 0,
    bearish: 0,
    neutral: 0,
    score: 0,
    confidence: 0.15,
    samples: [],
    notes: [note],
  };
}

function scoreTexts(texts: string[]): Omit<ChannelSentiment, "source" | "notes"> {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let raw = 0;
  const samples: string[] = [];
  for (const t of texts) {
    if (!t?.trim()) continue;
    samples.push(t.slice(0, 140));
    const b = BULL.test(t);
    const r = BEAR.test(t);
    if (b && !r) {
      bullish++;
      raw += 1;
    } else if (r && !b) {
      bearish++;
      raw -= 1;
    } else {
      neutral++;
    }
  }
  const n = samples.length;
  const score = n ? Math.max(-1, Math.min(1, raw / Math.max(3, n * 0.55))) : 0;
  const confidence = n
    ? Math.min(0.78, 0.28 + Math.min(n, 25) * 0.018 + Math.abs(score) * 0.15)
    : 0.15;
  return {
    sampleCount: n,
    bullish,
    bearish,
    neutral,
    score,
    confidence,
    samples: samples.slice(0, 5),
  };
}

function parseRssTitles(xml: string): string[] {
  const titles: string[] = [];
  const re = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const t = decodeEntities((m[1] ?? m[2] ?? "").trim());
    if (!t || t === "Google News") continue;
    if (t.startsWith('"') && t.includes(" - Google News")) continue;
    titles.push(t.replace(/\s+-\s+[^-]+$/, "").trim());
  }
  return titles.filter((t, i) => i > 0 || !t.includes("Google News"));
}

export async function fetchStockTwits(ticker: string): Promise<ChannelSentiment> {
  const sym = ticker.toUpperCase();
  return cached(
    `st:${sym}`,
    TTL.social,
    async () => {
      const data = await fetchJson<{
        messages?: Array<{ body?: string; entities?: { sentiment?: { basic?: string } } }>;
      }>(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(sym)}.json`, {
        "User-Agent": UA,
        Accept: "application/json",
      });
      const msgs = data?.messages ?? [];
      if (!msgs.length) return emptyChannel("stocktwits", "No StockTwits posts");
      const texts = msgs.map((m) => m.body ?? "").filter(Boolean);
      const scored = scoreTexts(texts);
      let labeled = 0;
      let labRaw = 0;
      for (const m of msgs) {
        const s = m.entities?.sentiment?.basic?.toLowerCase();
        if (s === "bullish") {
          labeled++;
          labRaw += 1;
        } else if (s === "bearish") {
          labeled++;
          labRaw -= 1;
        }
      }
      const labScore = labeled ? labRaw / labeled : 0;
      const score = labeled >= 4 ? 0.55 * scored.score + 0.45 * labScore : scored.score;
      return {
        source: "stocktwits" as const,
        ...scored,
        score: Math.max(-1, Math.min(1, score)),
        notes: [
          `StockTwits: ${scored.sampleCount} posts`,
          labeled ? `${labeled} labeled bull/bear` : "No labeled sentiment",
        ],
      };
    },
    { persist: (ch) => ch.sampleCount > 0, missTtlMs: 10_000 },
  );
}

export async function fetchRedditSentiment(
  ticker: string,
  companyName?: string | null,
): Promise<ChannelSentiment> {
  const sym = ticker.toUpperCase();
  const name = (companyName ?? "").split(/[,(]/)[0]?.trim() || sym;
  return cached(`reddit:${sym}`, TTL.social, async () => {
    const q = encodeURIComponent(`(${sym} OR $${sym} OR "${name}") site:reddit.com`);
    const xml = await fetchText(
      `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
      { "User-Agent": UA, Accept: "*/*" },
    );
    if (!xml) return emptyChannel("reddit", "Reddit headline feed unavailable");
    const titles = parseRssTitles(xml).slice(0, 18);
    if (!titles.length) return emptyChannel("reddit", "No recent Reddit-indexed headlines");
    const scored = scoreTexts(titles);
    return {
      source: "reddit" as const,
      ...scored,
      samples: titles.slice(0, 5),
      notes: [`Reddit-indexed: ${scored.sampleCount} headlines`],
    };
  });
}

export async function fetchPoliticalSentiment(
  ticker: string,
  companyName?: string | null,
): Promise<ChannelSentiment> {
  const sym = ticker.toUpperCase();
  const name = (companyName ?? "").split(/[,(]/)[0]?.trim() || sym;
  return cached(`pol:${sym}`, TTL.social, async () => {
    const q = encodeURIComponent(
      `(${sym} OR $${sym} OR "${name}") (Trump OR Congress OR tariff OR "export control" OR China OR regulation OR Biden OR Senate OR "White House" OR FTC OR SEC OR geopolitics OR "executive order" OR Lutnick OR Xi)`,
    );
    const xml = await fetchText(
      `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
      { "User-Agent": UA, Accept: "*/*" },
    );
    if (!xml) return emptyChannel("political", "Political news feed unavailable");
    const titles = parseRssTitles(xml).filter(
      (t) => POLITICAL.test(t) || /tariff|export|China|Congress|Trump|regulation|sanction/i.test(t),
    );
    const use = (titles.length ? titles : parseRssTitles(xml)).slice(0, 18);
    if (!use.length) return emptyChannel("political", "No recent political/policy headlines");
    const scored = scoreTexts(use);
    let adj = scored.score;
    const blob = use.join(" ").toLowerCase();
    if (/\b(export control|smuggl|sanction|ban|restriction|tariff|probe|detain)\b/.test(blob)) {
      adj = Math.max(-1, adj - 0.15);
    }
    if (/\b(subsidy|chip act|deregulat|deal|approval)\b/.test(blob)) {
      adj = Math.min(1, adj + 0.1);
    }
    return {
      source: "political" as const,
      ...scored,
      score: adj,
      samples: use.slice(0, 5),
      notes: [`Political/policy: ${scored.sampleCount} headlines`],
    };
  });
}

const MONEY_PEOPLE: Record<string, string[]> = {
  NVDA: ["Jensen Huang"],
  TSLA: ["Elon Musk"],
  AMZN: ["Andy Jassy", "Jeff Bezos"],
  META: ["Mark Zuckerberg"],
  MSFT: ["Satya Nadella"],
  GOOG: ["Sundar Pichai"],
  GOOGL: ["Sundar Pichai"],
  AAPL: ["Tim Cook"],
  TSM: ["C.C. Wei"],
  AMD: ["Lisa Su"],
  ASML: ["Christophe Fouquet"],
  AVGO: ["Hock Tan"],
  MU: ["Sanjay Mehrotra"],
  AMAT: ["Gary Dickerson"],
  KLAC: ["Rick Wallace"],
};

export async function fetchXChatter(
  ticker: string,
  companyName?: string | null,
): Promise<ChannelSentiment> {
  const sym = ticker.toUpperCase();
  const name = (companyName ?? "").split(/[,(]/)[0]?.trim() || sym;
  return cached(`x:${sym}`, TTL.social, async () => {
    const q = encodeURIComponent(
      `(${sym} OR $${sym} OR "${name}") (site:x.com OR site:twitter.com OR Twitter OR "on X")`,
    );
    const xml = await fetchText(
      `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
      { "User-Agent": UA, Accept: "*/*" },
    );
    if (!xml) return emptyChannel("x", "X/Twitter headline feed unavailable");
    const titles = parseRssTitles(xml).slice(0, 18);
    if (!titles.length) return emptyChannel("x", "No recent X/Twitter headlines found");
    const scored = scoreTexts(titles);
    return {
      source: "x" as const,
      ...scored,
      samples: titles.slice(0, 5),
      notes: [
        `X chatter: ${scored.sampleCount} indexed posts/headlines`,
        `${scored.bullish} upbeat · ${scored.bearish} downbeat`,
      ],
    };
  });
}

export async function fetchMoneyTalk(
  ticker: string,
  companyName?: string | null,
): Promise<ChannelSentiment> {
  const sym = ticker.toUpperCase();
  const name = (companyName ?? "").split(/[,(]/)[0]?.trim() || sym;
  const people = MONEY_PEOPLE[sym] ?? [];
  const peopleQ = people.map((p) => `"${p}"`).join(" OR ");
  return cached(`money:${sym}`, TTL.social, async () => {
    const q = encodeURIComponent(
      `(${sym} OR $${sym} OR "${name}") (BlackRock OR Blackstone OR "Larry Fink" OR "Steve Schwarzman"${peopleQ ? ` OR ${peopleQ}` : ""})`,
    );
    const xml = await fetchText(
      `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,
      { "User-Agent": UA, Accept: "*/*" },
    );
    if (!xml) return emptyChannel("money", "Big-money / CEO headline feed unavailable");
    const titles = parseRssTitles(xml).slice(0, 18);
    if (!titles.length) {
      return emptyChannel("money", "No recent BlackRock, Blackstone, or key-person headlines");
    }
    const scored = scoreTexts(titles);
    let adj = scored.score;
    const blob = titles.join(" ").toLowerCase();
    if (/\b(overweight|inflow|buy|stake|added|increase position)\b/.test(blob)) {
      adj = Math.min(1, adj + 0.15);
    }
    if (/\b(underweight|outflow|sold|trim|cut stake|exit)\b/.test(blob)) {
      adj = Math.max(-1, adj - 0.15);
    }
    return {
      source: "money" as const,
      ...scored,
      score: adj,
      samples: titles.slice(0, 5),
      notes: [
        `BlackRock/Blackstone/key people: ${scored.sampleCount} headlines`,
        `${scored.bullish} buy/inflow-leaning · ${scored.bearish} sell/outflow-leaning`,
      ],
    };
  });
}

export async function fetchSocialSentimentBundle(
  ticker: string,
  companyName?: string | null,
): Promise<SocialSentimentBundle> {
  const sym = ticker.toUpperCase();
  const nameKey = (companyName ?? "").slice(0, 40).toLowerCase();
  return cached(`social-bundle:${sym}:${nameKey}:v2`, TTL.social, async () => {
    const [stocktwits, reddit, political, x, money] = await Promise.all([
      fetchStockTwits(ticker),
      fetchRedditSentiment(ticker, companyName),
      fetchPoliticalSentiment(ticker, companyName),
      fetchXChatter(ticker, companyName),
      fetchMoneyTalk(ticker, companyName),
    ]);

    const parts = [
      { s: stocktwits.score, c: stocktwits.confidence, w: 0.28 },
      { s: reddit.score, c: reddit.confidence, w: 0.14 },
      { s: political.score, c: political.confidence, w: 0.18 },
      { s: x.score, c: x.confidence, w: 0.22 },
      { s: money.score, c: money.confidence, w: 0.18 },
    ];
    let num = 0;
    let den = 0;
    let conf = 0;
    for (const p of parts) {
      const w = p.w * (0.4 + 0.6 * p.c);
      num += p.s * w;
      den += w;
      conf += p.c * p.w;
    }
    return {
      stocktwits,
      reddit,
      political,
      x,
      money,
      blendedScore: den > 0 ? Math.max(-1, Math.min(1, num / den)) : 0,
      blendedConfidence: Math.min(0.82, Math.max(0.2, conf)),
      asOf: new Date().toISOString(),
    };
  });
}

export function emptySocialBundle(): SocialSentimentBundle {
  return {
    stocktwits: emptyChannel("stocktwits", "Not loaded"),
    reddit: emptyChannel("reddit", "Not loaded"),
    political: emptyChannel("political", "Not loaded"),
    x: emptyChannel("x", "Not loaded"),
    money: emptyChannel("money", "Not loaded"),
    blendedScore: 0,
    blendedConfidence: 0.15,
    asOf: new Date().toISOString(),
  };
}
