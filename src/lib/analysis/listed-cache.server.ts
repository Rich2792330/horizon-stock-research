import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTickers } from "./framework";
import { LISTED_STOCKS } from "./listed";
import type { AnalysisReport } from "./types";

const TTL_MS = 8 * 60 * 1000;
const DISK = join(process.cwd(), "data", "listed-live-cache.json");
const KEY = `listed10:${LISTED_STOCKS.join(",")}`;

type Slot = {
  key: string;
  at: number;
  report: AnalysisReport | null;
  inflight: Promise<AnalysisReport> | null;
};

const g = globalThis as typeof globalThis & { __horizonListed?: Slot };

function slot(): Slot {
  if (!g.__horizonListed) {
    g.__horizonListed = { key: KEY, at: 0, report: null, inflight: null };
  }
  return g.__horizonListed;
}

function readDisk(): { at: number; report: AnalysisReport } | null {
  try {
    const raw = readFileSync(DISK, "utf8");
    const parsed = JSON.parse(raw) as { key?: string; at?: number; report?: AnalysisReport };
    if (parsed.key !== KEY || !parsed.report?.results?.length) return null;
    return { at: parsed.at ?? 0, report: parsed.report };
  } catch {
    return null;
  }
}

function writeDisk(report: AnalysisReport, at: number) {
  try {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    writeFileSync(
      DISK,
      JSON.stringify({ key: KEY, at, report }),
      "utf8",
    );
  } catch {
    // Preview still works from memory if disk is unavailable.
  }
}

function hydrateFromDisk() {
  const s = slot();
  if (s.report) return;
  const disk = readDisk();
  if (!disk) return;
  s.report = disk.report;
  s.at = disk.at;
  s.key = KEY;
}

async function runListed(): Promise<AnalysisReport> {
  const report = await analyzeTickers([...LISTED_STOCKS]);
  const at = Date.now();
  const s = slot();
  s.key = KEY;
  s.at = at;
  s.report = report;
  writeDisk(report, at);
  return report;
}

export function peekListedAnalysis(): AnalysisReport | null {
  const s = slot();
  hydrateFromDisk();
  if (s.key !== KEY) return null;
  return s.report;
}

/** Drop bulky news/social blobs so the first page can actually open. */
export function slimForHome(report: AnalysisReport): AnalysisReport {
  return {
    ...report,
    overallMethodology: "",
    disclaimer: "",
    keyRisks: (report.keyRisks ?? []).slice(0, 3),
    abstainNotes: (report.abstainNotes ?? []).slice(0, 4),
    results: report.results.map((r) => ({
      ...r,
      methodologyNote: "",
      modules: (r.modules ?? []).slice(0, 6).map((m) => ({
        ...m,
        notes: (m.notes ?? []).slice(0, 1),
      })),
      snapshot: r.snapshot
        ? {
            ...r.snapshot,
            social: null,
            competitorNotes: [],
            calendarNotes: (r.snapshot.calendarNotes ?? []).slice(0, 1),
            sentiment: r.snapshot.sentiment
              ? {
                  ...r.snapshot.sentiment,
                  headlines: (r.snapshot.sentiment.headlines ?? []).slice(0, 2),
                }
              : r.snapshot.sentiment,
          }
        : null,
    })),
  };
}

/** Return cache immediately, or null if a live run would take too long. */
export async function getListedAnalysisFast(ms: number): Promise<AnalysisReport | null> {
  const peeked = peekListedAnalysis();
  if (peeked) {
    void getListedAnalysis().catch(() => null);
    return peeked;
  }
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    void getListedAnalysis()
      .then((r) => {
        clearTimeout(timer);
        resolve(r);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export function isDefaultList(tickers: string[]): boolean {
  if (tickers.length !== LISTED_STOCKS.length) return false;
  const set = new Set(tickers.map((t) => t.toUpperCase().trim()));
  return LISTED_STOCKS.every((t) => set.has(t));
}

/** Instant cache if we have one; otherwise run the default list now. */
export async function getListedAnalysis(opts?: {
  fresh?: boolean;
}): Promise<AnalysisReport> {
  const s = slot();
  hydrateFromDisk();

  if (s.key !== KEY) {
    s.key = KEY;
    s.report = null;
    s.at = 0;
  }

  const age = s.report ? Date.now() - s.at : Number.POSITIVE_INFINITY;
  const stale = !s.report || age > TTL_MS;

  if (!opts?.fresh && s.report && !stale) return s.report;

  if (!s.inflight) {
    s.inflight = runListed().finally(() => {
      const cur = slot();
      cur.inflight = null;
    });
  }

  if (!opts?.fresh && s.report) return s.report;
  return s.inflight;
}
