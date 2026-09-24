import { cached, TTL } from "./cache";
import { fetchJson } from "./http";

const UA =
  "Mozilla/5.0 (compatible; HorizonResearch/1.0; +https://example.local/research)";

/** Decision-day dates (FOMC statement). Source: Federal Reserve 2026 calendar. */
const FOMC_DECISION = [
  "2026-09-16",
  "2026-10-28",
  "2026-12-09",
  "2027-01-28",
  "2027-03-18",
  "2027-05-06",
  "2027-06-17",
];

/** Official BLS CPI release dates. */
const CPI_RELEASE = [
  "2026-09-11",
  "2026-10-14",
  "2026-11-10",
  "2026-12-10",
  "2027-01-14",
  "2027-02-11",
];

export interface EventCalendar {
  daysToEarnings: number | null;
  earningsLabel: string | null;
  daysToFed: number | null;
  daysToCpi: number | null;
  nextEvent: string | null;
  notes: string[];
}

function daysUntil(iso: string, now = new Date()): number {
  const t = Date.parse(`${iso}T16:00:00Z`);
  return Math.round((t - now.getTime()) / 86_400_000);
}

function nextDated(list: string[]): { iso: string; days: number } | null {
  const now = new Date();
  for (const iso of list) {
    const d = daysUntil(iso, now);
    if (d >= -1) return { iso, days: d };
  }
  return null;
}

export async function fetchEarningsDate(ticker: string): Promise<{
  days: number | null;
  label: string | null;
}> {
  const sym = ticker.toUpperCase();
  return cached(`earn-date:${sym}`, TTL.meta, async () => {
    const data = await fetchJson<{
      quoteResponse?: {
        result?: Array<{
          earningsTimestamp?: number;
          earningsTimestampStart?: number;
          earningsTimestampEnd?: number;
        }>;
      };
    }>(
      [
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=earningsTimestamp,earningsTimestampStart,earningsTimestampEnd`,
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=earningsTimestamp,earningsTimestampStart,earningsTimestampEnd`,
      ],
      { "User-Agent": UA, Accept: "application/json" },
    );
    const q = data?.quoteResponse?.result?.[0];
    const ts = q?.earningsTimestampStart ?? q?.earningsTimestamp ?? q?.earningsTimestampEnd;
    if (!ts) return { days: null, label: null };
    const when = new Date(ts * 1000);
    const days = Math.round((when.getTime() - Date.now()) / 86_400_000);
    const label = when.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return { days, label };
  });
}

export async function buildEventCalendar(ticker: string): Promise<EventCalendar> {
  const earn = await fetchEarningsDate(ticker);
  const fed = nextDated(FOMC_DECISION);
  const cpi = nextDated(CPI_RELEASE);
  const notes: string[] = [];
  if (earn.days != null && earn.label) {
    notes.push(
      earn.days >= 0
        ? `Earnings in ${earn.days} day${earn.days === 1 ? "" : "s"} (${earn.label})`
        : `Earnings were ${Math.abs(earn.days)} day${Math.abs(earn.days) === 1 ? "" : "s"} ago (${earn.label})`,
    );
  } else {
    notes.push("No earnings date on the public calendar");
  }
  if (fed) notes.push(`Fed rate decision in ${fed.days} day${fed.days === 1 ? "" : "s"} (${fed.iso})`);
  if (cpi) notes.push(`CPI inflation report in ${cpi.days} day${cpi.days === 1 ? "" : "s"} (${cpi.iso})`);

  const upcoming: Array<{ days: number; label: string }> = [];
  if (earn.days != null && earn.days >= 0 && earn.days <= 45) {
    upcoming.push({ days: earn.days, label: "earnings" });
  }
  if (fed && fed.days <= 45) upcoming.push({ days: fed.days, label: "Fed meeting" });
  if (cpi && cpi.days <= 45) upcoming.push({ days: cpi.days, label: "CPI report" });
  upcoming.sort((a, b) => a.days - b.days);
  const next = upcoming[0]
    ? `${upcoming[0].label} in ${upcoming[0].days} day${upcoming[0].days === 1 ? "" : "s"}`
    : null;

  return {
    daysToEarnings: earn.days,
    earningsLabel: earn.label,
    daysToFed: fed?.days ?? null,
    daysToCpi: cpi?.days ?? null,
    nextEvent: next,
    notes,
  };
}

export const EMPTY_CALENDAR: EventCalendar = {
  daysToEarnings: null,
  earningsLabel: null,
  daysToFed: null,
  daysToCpi: null,
  nextEvent: null,
  notes: ["Calendar skipped on the fast pass"],
};
