import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTicker, DISCLAIMER } from "./framework";
import {
  RISER_MIN_CONFIDENCE,
  SCAN_UNIVERSE,
  toHit,
  clearedRise70,
  type RiserScanReport,
  type ScanHit,
} from "./scan";
import { identityFor, LISTED_STOCKS } from "./listed";
import { peekListedAnalysis } from "./listed-cache.server";
import { prefetchMacro, fetchSearchMeta } from "./market-data";
import { livePeerSnaps } from "./peer-tape";
import type { TickerAnalysis } from "./types";
import type { BarSeries } from "./market-data";
import type { PeerSnap } from "./peer-tape";

const DISK = join(process.cwd(), "data", "riser-scan-cache.json");
const KEY = "risers70:v13:cal2";
const STALE_MS = 6 * 60 * 60 * 1000;
const BATCH = 6;
const TICKER_MS = 8_000;
const BATCH_MS = 14_000;
const HIT_SHOW = 12;
const POOL_SHOW = 20;

type Slot = {
  key: string;
  at: number;
  startedAt: number;
  busy: boolean;
  report: RiserScanReport | null;
  lastDone: RiserScanReport | null;
  fullPool: ScanHit[];
  macro: {
    spy: BarSeries | null;
    vix: BarSeries | null;
    tnx: BarSeries | null;
    uup: BarSeries | null;
    hyg: BarSeries | null;
  } | null;
  peers: PeerSnap[] | null;
};

const g = globalThis as typeof globalThis & {
  __horizonScan?: Slot;
  __horizonScanLoop?: ReturnType<typeof setInterval>;
  __horizonScanLoopKey?: string;
};

function slot(): Slot {
  if (!g.__horizonScan) {
    g.__horizonScan = {
      key: KEY,
      at: 0,
      startedAt: 0,
      busy: false,
      report: null,
      lastDone: null,
      fullPool: [],
      macro: null,
      peers: null,
    };
  }
  return g.__horizonScan;
}

function unique(tickers: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tickers) {
    const u = t.toUpperCase().trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function universe(): string[] {
  return unique([...LISTED_STOCKS, ...SCAN_UNIVERSE]);
}

function keep70(hits: ScanHit[]): ScanHit[] {
  const seen = new Set<string>();
  return hits
    .filter((h) => clearedRise70(h) >= RISER_MIN_CONFIDENCE && h.liquidityFlag !== "low")
    .sort(
      (a, b) =>
        b.expectedReturn - a.expectedReturn ||
        clearedRise70(b) - clearedRise70(a),
    )
    .filter((h) => {
      if (seen.has(h.ticker)) return false;
      seen.add(h.ticker);
      return true;
    });
}

function emptyReport(partial?: Partial<RiserScanReport>): RiserScanReport {
  return {
    asOf: new Date().toISOString(),
    minConfidence: RISER_MIN_CONFIDENCE,
    horizon: "1m",
    universeSize: universe().length,
    scanned: 0,
    failed: 0,
    durationMs: 0,
    hits: [],
    nearMisses: [],
    notes: [],
    disclaimer: DISCLAIMER,
    done: false,
    pool: [],
    phase: "searching",
    ...partial,
  };
}

function readDisk(): { at: number; report: RiserScanReport; lastDone: RiserScanReport | null } | null {
  try {
    const parsed = JSON.parse(readFileSync(DISK, "utf8")) as {
      key?: string;
      at?: number;
      report?: RiserScanReport;
      lastDone?: RiserScanReport | null;
    };
    if (parsed.key !== KEY || !parsed.report) return null;
    return {
      at: parsed.at ?? 0,
      report: parsed.report,
      lastDone: parsed.lastDone ?? (parsed.report.done ? parsed.report : null),
    };
  } catch {
    return null;
  }
}

function writeDisk(report: RiserScanReport, at: number) {
  try {
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    const s = slot();
    const slim = (r: RiserScanReport): RiserScanReport => ({
      ...r,
      hits: (r.hits ?? []).slice(0, HIT_SHOW),
      pool: (r.pool ?? []).slice(0, POOL_SHOW),
      nearMisses: [],
      disclaimer: "",
    });
    writeFileSync(
      DISK,
      JSON.stringify({
        key: KEY,
        at,
        report: slim(report),
        lastDone: s.lastDone ? slim(s.lastDone) : null,
      }),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

function hydrateFromDisk() {
  const s = slot();
  if (s.key !== KEY) {
    s.key = KEY;
    s.report = null;
    s.lastDone = null;
    s.at = 0;
    s.startedAt = 0;
    s.busy = false;
    s.fullPool = [];
  }
  if (s.report) return;
  const disk = readDisk();
  if (!disk) return;
  s.report = disk.report;
  s.lastDone = disk.lastDone;
  s.at = disk.at;
  s.fullPool = disk.report.pool ?? [];
}

function save(report: RiserScanReport) {
  const at = Date.now();
  const s = slot();
  if (!s.startedAt) s.startedAt = at;
  s.key = KEY;
  s.at = at;
  const next = { ...report, durationMs: at - s.startedAt };
  s.report = next;
  if (next.done) s.lastDone = next;
  writeDisk(next, at);
}

/** In-progress runs keep showing the last finished 70% list so the screen does not jump. */
function forDisplay(report: RiserScanReport): RiserScanReport {
  const s = slot();
  if (report.done) return slimScan(report);
  if (s.lastDone?.hits?.length) {
    return slimScan({
      ...report,
      hits: s.lastDone.hits,
      pool: s.lastDone.pool ?? [],
      notes: [
        `Checking ${report.scanned.toLocaleString()} of ${report.universeSize.toLocaleString()} names. Last finished list stays on screen until this run completes.`,
      ],
    });
  }
  return slimScan({
    ...report,
    hits: [],
    pool: [],
    notes: [
      `Checking ${report.scanned.toLocaleString()} of ${report.universeSize.toLocaleString()} names. The 70% list waits until this run finishes.`,
    ],
  });
}

function decorate(h: ScanHit): ScanHit {
  const id = identityFor(h.ticker, {
    name: h.name,
    industry: h.industry ?? h.sector,
    sector: h.sector,
  });
  return { ...h, name: id.name || h.name, industry: id.industry || h.industry };
}

async function fillIdentity(hits: ScanHit[]): Promise<ScanHit[]> {
  return Promise.all(
    hits.map(async (h) => {
      const missingName = !h.name || h.name.toUpperCase() === h.ticker.toUpperCase();
      if (!missingName && h.industry) return decorate(h);
      try {
        const m = await withDeadline(fetchSearchMeta(h.ticker), 2500, {
          name: h.name,
          sector: h.sector,
          industry: h.industry,
        });
        const name =
          m.name && m.name.toUpperCase() !== h.ticker.toUpperCase() ? m.name : h.name;
        return decorate({
          ...h,
          name: name || h.name,
          industry: m.industry || h.industry,
          sector: m.sector || h.sector,
        });
      } catch {
        return decorate(h);
      }
    }),
  );
}

function mergePool(a: ScanHit[], b: ScanHit[]): ScanHit[] {
  const map = new Map<string, ScanHit>();
  for (const h of [...a, ...b]) map.set(h.ticker, decorate(h));
  return [...map.values()];
}

function strength(h: ScanHit): number {
  const one = !h.abstain && h.direction === "Increase" ? h.confidence : 0;
  const three =
    h.h3 && !h.h3.abstain && h.h3.direction === "Increase" ? h.h3.confidence : 0;
  const six =
    h.h6 && !h.h6.abstain && h.h6.direction === "Increase" ? h.h6.confidence : 0;
  return Math.max(one, three, six, h.confidence * 0.25);
}

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch(() => {
      clearTimeout(t);
      resolve(fallback);
    });
  });
}

function failedRow(ticker: string): TickerAnalysis {
  return {
    ticker,
    snapshot: null,
    modules: [],
    horizons: [],
    risk: {
      realizedVol21d: null,
      realizedVol63d: null,
      betaSpy: null,
      maxDrawdown6m: null,
      avgDollarVolume: null,
      liquidityFlag: "unknown",
      estimatedRoundTripBps: null,
      stressScenarios: [],
      riskNotes: [],
    },
    keyDrivers: "",
    methodologyNote: "",
    error: "Timed out",
  };
}

async function processBatch() {
  const s = slot();
  hydrateFromDisk();
  const names = universe();
  const n = names.length;
  if (!s.report || s.report.done) return;
  const scanned = Math.max(0, s.report.scanned);
  if (scanned >= n) {
    save({
      ...s.report,
      done: true,
      phase: "done",
      scanned: n,
      notes: [
        `Last finished look · ${n.toLocaleString()} names scored.`,
        s.report.hits.length
          ? `Showing ${s.report.hits.length} names at ${RISER_MIN_CONFIDENCE}%+ sure to rise next month.`
          : `None at ${RISER_MIN_CONFIDENCE}% sure to rise next month.`,
      ],
    });
    return;
  }

  if (!s.macro) {
    s.macro = await withDeadline(prefetchMacro("2y"), 8_000, {
      spy: null,
      vix: null,
      tnx: null,
      uup: null,
      hyg: null,
    });
  }
  if (!s.peers) {
    s.peers = await withDeadline(livePeerSnaps(), 8_000, []);
  }

  const slice = names.slice(scanned, scanned + BATCH);
  const rows = await withDeadline(
    Promise.all(
      slice.map((t) =>
        withDeadline(
          analyzeTicker(t, { ...s.macro!, peerSnaps: s.peers!, light: true }),
          TICKER_MS,
          failedRow(t),
        ),
      ),
    ),
    BATCH_MS,
    slice.map(failedRow),
  );
  const part = rows.map(toHit).filter((h): h is ScanHit => h != null);
  s.fullPool = mergePool(s.fullPool, part);
  const ranked = [...s.fullPool].sort((a, b) => strength(b) - strength(a));
  const hitsAll = keep70(s.fullPool);
  const next = Math.min(n, scanned + slice.length);
  const failed = (s.report.failed ?? 0) + rows.filter((r) => r.error || !r.horizons.length).length;
  const shown = await fillIdentity(hitsAll.slice(0, HIT_SHOW));
  const poolShow = await fillIdentity(ranked.slice(0, POOL_SHOW));
  save(
    emptyReport({
      scanned: next,
      failed,
      hits: shown,
      pool: poolShow,
      universeSize: n,
      durationMs: s.startedAt ? Date.now() - s.startedAt : 0,
      done: next >= n,
      phase: next >= n ? "done" : "searching",
      notes: [
        next >= n
          ? `Last finished look · ${next.toLocaleString()} names scored.`
          : `Full model on ${next} of ${n} names.`,
        hitsAll.length
          ? `Showing the top ${shown.length} of ${hitsAll.length} names at ${RISER_MIN_CONFIDENCE}%+ sure to rise next month.`
          : `None at ${RISER_MIN_CONFIDENCE}% sure to rise next month yet.`,
      ],
    }),
  );
}

async function tickOnce() {
  const s = slot();
  if (s.busy) {
    if (Date.now() - (s.at || 0) > 20_000) s.busy = false;
    else return;
  }
  hydrateFromDisk();
  if (s.report?.done) return;
  if (!s.report) {
    const listed = peekListedAnalysis();
    const pool = (listed?.results ?? [])
      .map((r) => toHit(r))
      .filter((h): h is ScanHit => h != null);
    s.fullPool = mergePool([], pool);
    const ranked = [...s.fullPool].sort((a, b) => strength(b) - strength(a));
    const hitsAll = keep70(s.fullPool);
    save(
      emptyReport({
        scanned: 0,
        hits: hitsAll.slice(0, HIT_SHOW),
        pool: ranked.slice(0, POOL_SHOW),
        notes: [`Starting. Running the 1/3/6-month model on all ${universe().length} names.`],
      }),
    );
  }
  s.busy = true;
  try {
    await processBatch();
  } catch {
    /* next tick retries */
  } finally {
    s.busy = false;
  }
}

function ensureLoop() {
  if (g.__horizonScanLoop && g.__horizonScanLoopKey === KEY) return;
  if (g.__horizonScanLoop) clearInterval(g.__horizonScanLoop);
  g.__horizonScanLoopKey = KEY;
  g.__horizonScanLoop = setInterval(() => {
    void tickOnce();
  }, 280);
}

/** Keep a running look moving. Never resets a finished look — that was flipping the page on every reload. */
export function ensureScanLoop() {
  hydrateFromDisk();
  ensureLoop();
}

function listedPool(): ScanHit[] {
  const listed = peekListedAnalysis();
  return mergePool(
    [],
    (listed?.results ?? []).map((r) => toHit(r)).filter((h): h is ScanHit => h != null),
  );
}

export function idleRiserScan(): RiserScanReport {
  const pool = listedPool();
  return emptyReport({
    done: false,
    scanned: 0,
    hits: keep70(pool),
    pool,
    notes: ["Starting a look through 1,000 names."],
  });
}

export function peekRiserScan(): RiserScanReport | null {
  const s = slot();
  hydrateFromDisk();
  if (s.key !== KEY) return null;
  return s.report ? forDisplay(s.report) : null;
}

export function slimScan(report: RiserScanReport): RiserScanReport {
  return {
    ...report,
    hits: (report.hits ?? []).slice(0, HIT_SHOW),
    pool: (report.pool ?? []).slice(0, POOL_SHOW),
    nearMisses: [],
    disclaimer: "",
  };
}

/** Start a scan. Pass force to throw out a finished (or stuck) look and run 1,000 names again. */
export function openRiserScan(force = false): RiserScanReport {
  const s = slot();
  hydrateFromDisk();
  ensureLoop();
  if (!force && s.report && s.report.done !== true) return forDisplay(s.report);
  const keep = (s.report?.hits?.length ? s.report.hits : s.report?.pool) ?? listedPool();
  s.fullPool = force ? [...keep] : mergePool(s.fullPool, keep);
  s.busy = false;
  s.macro = null;
  s.peers = null;
  s.startedAt = Date.now();
  const hitsAll = keep70(s.fullPool);
  const next = emptyReport({
    done: false,
    scanned: 0,
    hits: hitsAll.slice(0, HIT_SHOW),
    pool: [...s.fullPool].sort((a, b) => strength(b) - strength(a)).slice(0, POOL_SHOW),
    notes: [
      force
        ? "Fresh look through all 1,000 names. Last names stay on screen until new scores replace them."
        : "Checking all 1,000 names. Outlooks stay on screen while it runs.",
    ],
  });
  save(next);
  return forDisplay(next);
}

export async function getRiserScan(opts?: { fresh?: boolean }): Promise<RiserScanReport> {
  if (opts?.fresh) return openRiserScan(true);
  const s = slot();
  hydrateFromDisk();
  ensureLoop();
  if (s.report && s.report.done !== true) return forDisplay(s.report);
  if (s.report?.done) {
    const age = Date.now() - (s.at || 0);
    if (age > STALE_MS) return openRiserScan(true);
    return forDisplay(s.report);
  }
  return openRiserScan(false);
}

ensureLoop();
