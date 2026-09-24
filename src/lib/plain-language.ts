import { formatPct } from "@/lib/utils";
import type { Direction, Horizon, HorizonForecast, MarketSnapshot, ModuleScore } from "@/lib/analysis/types";

export function directionShort(d: Direction): string {
  if (d === "Increase") return "Rise";
  if (d === "Decrease") return "Fall";
  return "Even";
}

export function directionTitle(d: Direction): string {
  if (d === "Increase") return "Likely to rise";
  if (d === "Decrease") return "Likely to fall";
  return "No clear call";
}

export function directionHint(d: Direction): string {
  if (d === "Increase") return "The model leans up from here.";
  if (d === "Decrease") return "The model leans down from here.";
  return "Signals conflict or are too weak to pick a side.";
}

export function horizonTitle(hz: Horizon): string {
  if (hz === "1m") return "Next month";
  if (hz === "3m") return "Next 3 months";
  return "Next 6 months";
}

export function horizonSubtitle(hz: Horizon): string {
  if (hz === "1m") return "About 20 trading days";
  if (hz === "3m") return "About one quarter";
  return "About half a year";
}

export function sureLabel(confidence: number): string {
  if (confidence >= 70) return "Fairly sure";
  if (confidence >= 60) return "Somewhat sure";
  if (confidence >= 52) return "Only a mild lean";
  return "Not sure enough";
}

export function spellOutDrivers(line: string): string {
  return line
    .replace(
      /1M leader: strong in its own group this month while the market is up/gi,
      "Next month: it is a leader in its own group, and the overall market is up",
    )
    .replace(
      /1M leader: among the strongest names this month while the market is up/gi,
      "Next month: this is one of the strongest names this month, and the overall market is up",
    )
    .replace(
      /1M muted: overall market is not up this month/gi,
      "Next month: the overall market is not up, so the model will not call a rise",
    )
    .replace(
      /1M muted: fear is rising even if VIX is not high yet/gi,
      "Next month: fear is rising, so the model will not call a rise",
    )
    .replace(
      /1M muted: junk bonds are sliding — tape is breaking/gi,
      "Next month: junk bonds are sliding — the tape looks like it is breaking, so the model will not call a rise",
    )
    .replace(
      /1M blocked: expected move smaller than trading costs/gi,
      "Next month: the expected move is smaller than trading costs, so the model sits out",
    )
    .replace(
      /1M muted: not among the strongest names this month/gi,
      "Next month: not among the strongest names this month — sitting out",
    )
    .replace(
      /1M muted: market fear \(VIX\) is too high/gi,
      "Next month: market fear is too high, so the model will not call a rise",
    )
    .replace(
      /1M muted: 3-month trend is not up/gi,
      "Next month: the 3-month trend is not up, so the model will not call a rise",
    )
    .replace(
      /1M muted: non-US listing — different close than this tape/gi,
      "Next month: this listing closes on a different clock than the US tape, so the model will not call a 1-month rise",
    )
    .replace(
      /1M muted: already ran too far this month — next month often fades/gi,
      "Next month: it already ran too far this month, so the model sits out the usual fade",
    )
    .replace(
      /1M muted: lagging the market this month/gi,
      "Next month: it is lagging the market, so the model will not call a rise",
    )
    .replace(
      /1M muted: still below its 50-day average/gi,
      "Next month: it is still below its 50-day average, so the model will not call a rise",
    )
    .replace(
      /1M continuation: winning this month and beating the market/gi,
      "Next month: it is already winning this month and beating the market",
    )
    .replace(
      /1M blocked: headlines\/social\/politics too negative/gi,
      "Next month: recent headlines or social/political chatter is too negative, so the model will not call a rise",
    )
    .replace(
      /1M blocked: yields jumped — growth under pressure/gi,
      "Next month: yields jumped, so the model will not call a rise in growth names",
    )
    .replace(
      /History-trained next-month/gi,
      "From this stock’s own history, next month",
    )
    .replace(
      /1M blocked: still sliding this week/gi,
      "Next month: it is still sliding this week — not catching a falling knife",
    )
    .replace(
      /1M blocked: 3-month lean is down/gi,
      "Next month: the 3-month lean is down, so a rise call is blocked",
    )
    .replace(
      /1M blocked: already ran 21d — wait for a reset/gi,
      "Next month: it already ran hard recently, so the model is waiting for a pause",
    )
    .replace(
      /1M blocked: crowded near 52-week high/gi,
      "Next month: sitting near a 52-week high, so the model will not chase",
    )
    .replace(
      /1M blocked: RSI still elevated/gi,
      "Next month: the short-term gauge is still stretched",
    )
    .replace(
      /1M blocked: uptrend but short-term extended/gi,
      "Next month: the medium trend is up, but the recent move looks stretched",
    )
    .replace(
      /1M blocked: downtrend but short-term washed out/gi,
      "Next month: the medium trend is down, but the recent drop looks washed out",
    )
    .replace(
      /1M confirm: uptrend \+ reset \/ non-extended setup/gi,
      "Next month: uptrend with a reset — not chasing a spike",
    )
    .replace(
      /1M confirm: downtrend \+ non-oversold setup/gi,
      "Next month: downtrend without a washed-out bounce setup",
    )
    .replace(
      /1M muted: no trend\+setup confirmation/gi,
      "Next month: trend and short-term setup do not agree",
    )
    .replace(/Intermediate trend \(bullish\)/gi, "Medium-term trend looks up")
    .replace(/Intermediate trend \(bearish\)/gi, "Medium-term trend looks down")
    .replace(/Short-term setup \(bullish\)/gi, "Recent setup looks constructive")
    .replace(/Short-term setup \(bearish\)/gi, "Recent setup looks stretched")
    .replace(/Abstain 1M/gi, "Sitting out the next-month call")
    .replace(/1M\b/g, "next month")
    .replace(/3M\b/g, "3 months")
    .replace(/6M\b/g, "6 months");
}

function sideWord(d: Direction): "rise" | "fall" | "stay even" {
  if (d === "Increase") return "rise";
  if (d === "Decrease") return "fall";
  return "stay even";
}

function hzWord(hz: Horizon): string {
  if (hz === "1m") return "next month";
  if (hz === "3m") return "the next 3 months";
  return "the next 6 months";
}

function cleanQuote(s: string, max = 110): string {
  const t = s.replace(/\s+/g, " ").replace(/[“”]/g, '"').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function businessCause(s: MarketSnapshot | null | undefined): string[] {
  if (!s) return [];
  const bits: string[] = [];
  const who = s.name && s.name !== s.ticker ? s.name : s.ticker;
  const field = [s.industry, s.sector].filter(Boolean).join(", ");
  if (field) bits.push(`${who} is in ${field}`);
  else bits.push(`${who}`);

  if (s.revGrowthYoy != null) {
    bits.push(
      s.revGrowthYoy >= 0
        ? `sales are still growing (about ${formatPct(s.revGrowthYoy)} year over year)`
        : `sales have been shrinking (about ${formatPct(s.revGrowthYoy)} year over year)`,
    );
  }
  if (s.niGrowthYoy != null) {
    bits.push(
      s.niGrowthYoy >= 0
        ? `profits are up about ${formatPct(s.niGrowthYoy)} year over year`
        : `profits are down about ${formatPct(s.niGrowthYoy)} year over year`,
    );
  }
  if (s.roe != null && s.roe > 0.12) {
    bits.push(`it earns a solid return on equity (about ${(s.roe * 100).toFixed(0)}%)`);
  }
  if (s.isAiHighGrowth) {
    bits.push(
      "it sits in the AI / high-growth tech group, so it tends to keep attracting money when that theme is in demand",
    );
  }
  if (s.isCommodityLike) {
    bits.push(
      "it moves with metals or commodities, so it can keep rising when that bid is still in place",
    );
  }
  return bits;
}

function newsCause(s: MarketSnapshot | null | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  const nameKeys = (s.name ?? "")
    .split(/[\s,./]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 3 && !/inc|corp|corporation|company|ltd|plc|class|ordinary|the|and/.test(w));
  const keys = [s.ticker.toLowerCase(), ...nameKeys];
  const relevant = (titles: string[]) =>
    titles
      .map((h) => cleanQuote(h))
      .filter((h) => h.length > 20 && keys.some((k) => h.toLowerCase().includes(k)));

  const heads = relevant(s.sentiment?.headlines ?? []).slice(0, 2);
  if (heads.length) {
    out.push(
      heads.length === 1
        ? `Company news in the sample: “${heads[0]}.”`
        : `Company news in the sample: “${heads[0]}” and “${heads[1]}.”`,
    );
  }
  const polHit = relevant(s.social?.political?.samples ?? [])[0];
  if (polHit && s.social && s.social.political.score > 0.08) {
    out.push(`Policy item that could help: “${polHit}.”`);
  } else if (polHit && s.social && s.social.political.score < -0.08) {
    out.push(`Policy item that could hurt: “${polHit}.”`);
  }
  return out;
}

/** Full reason whenever confidence is above 60. Uses real company facts, not just the tape. */
export function explainHighConfidence(args: {
  horizon: Horizon;
  direction: Direction;
  confidence: number;
  expectedReturn: number;
  snapshot?: MarketSnapshot | null;
  modules?: ModuleScore[];
  drivers?: string[];
}): string | undefined {
  if (args.confidence <= 60) return undefined;
  const side = sideWord(args.direction);
  const when = hzWord(args.horizon);
  const s = args.snapshot;
  const biz = businessCause(s);
  const news = newsCause(s);
  const hasStory = Boolean(
    (s?.revGrowthYoy != null && Math.abs(s.revGrowthYoy) > 0.02) ||
      (s?.niGrowthYoy != null && Math.abs(s.niGrowthYoy) > 0.02) ||
      news.length ||
      s?.isAiHighGrowth ||
      s?.isCommodityLike ||
      s?.industry,
  );

  const open = `Why ${args.confidence}% confident it will ${side} ${when}: `;

  if (args.direction === "Increase") {
    const cause =
      biz.length > 1
        ? biz[0] + " — " + biz.slice(1).join("; ") + "."
        : biz[0]
          ? biz[0] + "."
          : "";
    const newsBit = news.length ? ` ${news.join(" ")}` : "";
    const gap =
      !hasStory
        ? " Filings and headlines did not show a specific company catalyst, so this is not a ‘we know the product news’ call."
        : "";
    const mechanism =
      args.horizon === "1m" && args.confidence >= 68
        ? ` Money has already been paying up for this name while the broad market is still advancing and fear is low — that combination, not a slogan, is what tested at about 7 in 10 next-month rises.`
        : ` Those business and news facts are lining up on the same side as the measured outlook.`;
    return (
      open +
      (cause ? ` ${cause}` : "") +
      newsBit +
      gap +
      mechanism +
      ` Expected move about ${formatPct(args.expectedReturn)}.`
    ).replace(/\s+/g, " ").trim();
  }

  if (args.direction === "Decrease") {
    const hurt: string[] = [];
    if (s?.revGrowthYoy != null && s.revGrowthYoy < 0) {
      hurt.push(`sales are shrinking (${formatPct(s.revGrowthYoy)} year over year)`);
    }
    if (s?.niGrowthYoy != null && s.niGrowthYoy < 0) {
      hurt.push(`profits are shrinking (${formatPct(s.niGrowthYoy)} year over year)`);
    }
    const newsBit = news.length ? ` ${news.join(" ")}` : "";
    const bizHurt = hurt.length ? ` ${hurt.join("; ")}.` : "";
    return (
      `${open}the evidence leans toward less demand for the shares.${bizHurt}${newsBit} Expected move about ${formatPct(args.expectedReturn)}.`
    ).replace(/\s+/g, " ").trim();
  }

  return undefined;
}

export function attachWhy(
  horizons: HorizonForecast[],
  snapshot: MarketSnapshot | null,
  modules: ModuleScore[],
): HorizonForecast[] {
  return horizons.map((h) => ({
    ...h,
    whyConfident: explainHighConfidence({
      horizon: h.horizon,
      direction: h.direction,
      confidence: h.confidence,
      expectedReturn: h.expectedReturn,
      snapshot,
      modules,
      drivers: h.drivers,
    }),
  }));
}

export function highConfidenceNotes(horizons: HorizonForecast[]): string | null {
  const lines = horizons
    .filter((h) => h.confidence > 60 && h.whyConfident)
    .map((h) => h.whyConfident!);
  return lines.length ? lines.join(" ") : null;
}
