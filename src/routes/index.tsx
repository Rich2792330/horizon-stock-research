import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { HardLink } from "@/components/hard-link";
import { ResultsPanel } from "@/components/results-panel";
import { ScreenHeader } from "@/components/screen-header";
import { TickerLookup } from "@/components/ticker-picker";
import { TopRisers } from "@/components/top-risers";
import { LISTED_STOCKS, displayTicker } from "@/lib/analysis/listed";
import { loadHomeDesk, runHorizonAnalysis, runRiserScan } from "@/lib/analysis/server";
import type { RiserScanReport } from "@/lib/analysis/scan";
import type { AnalysisReport, TickerAnalysis } from "@/lib/analysis/types";
import { parseTickers } from "@/lib/utils";

function parseQueryTickers(q: string): string[] {
  return parseTickers(q).slice(0, 12);
}

function emptyRow(ticker: string, error?: string): TickerAnalysis {
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
    error,
  };
}

function padListed(report: AnalysisReport, wanted: string[]): AnalysisReport {
  const seen = new Set<string>();
  const results: TickerAnalysis[] = [];
  for (const r of report.results) {
    if (!wanted.includes(r.ticker) || seen.has(r.ticker)) continue;
    results.push(r);
    seen.add(r.ticker);
  }
  for (const t of wanted) {
    if (seen.has(t)) continue;
    results.push(emptyRow(t));
  }
  return { ...report, tickers: results.map((r) => r.ticker), results };
}

function skeletonReport(tickers: string[]): AnalysisReport {
  return {
    asOf: "2026-01-01T00:00:00.000Z",
    tickers,
    results: tickers.map((t) => emptyRow(t)),
    overallMethodology: "",
    keyRisks: [],
    abstainNotes: [],
    disclaimer: "",
  };
}

function HomeView({
  report,
  scan,
  extra,
  extraBusy,
  onCheck,
  onRefresh,
}: {
  report: AnalysisReport;
  scan: RiserScanReport | null;
  extra: AnalysisReport | null;
  extraBusy: boolean;
  onCheck: (tickers: string[]) => void;
  onRefresh: () => void;
}) {
  return (
    <div>
      <ScreenHeader
        title="Your list"
        subtitle={`${LISTED_STOCKS.length} names you always watch, plus 70%+ next-month risers when a look is finished. Type any other symbol below.`}
      />

      <TickerLookup busy={extraBusy} onCheck={onCheck} />

      {extraBusy && !extra && (
        <p className="mb-3 px-1 text-[12px] text-fg-muted">Checking the symbol you typed…</p>
      )}
      {extra && (
        <div className="mb-3">
          <ResultsPanel report={extra} />
        </div>
      )}

      <div className="mb-3">
        <TopRisers
          scan={scan}
          updating={scan != null && scan.done === false}
          onRefresh={onRefresh}
        />
      </div>

      <ResultsPanel report={report} />

      <section className="panel relative z-10 mt-3 space-y-2 p-3">
        <p className="text-[11px] leading-snug text-fg-muted">
          {LISTED_STOCKS.map(displayTicker).join(" · ")}
        </p>
        <HardLink
          href="/guide"
          className="text-[12px] font-medium text-fg underline-offset-4 hover:underline"
        >
          How it works
        </HardLink>
      </section>
    </div>
  );
}

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => {
    if (typeof s.q === "string" && s.q.trim()) {
      const q = parseQueryTickers(s.q).join(",");
      if (q) return { q };
    }
    return {};
  },
  ssr: true,
  pendingMs: 60_000,
  loader: async () => {
    try {
      const desk = await loadHomeDesk({ data: {} });
      return { listed: desk.listed, scan: desk.scan };
    } catch {
      return { listed: null as AnalysisReport | null, scan: null as RiserScanReport | null };
    }
  },
  staleTime: 15_000,
  component: AnalyzeScreen,
});

function AnalyzeScreen() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const fromUrl = search.q ? parseQueryTickers(search.q) : null;
  const tickers = [...LISTED_STOCKS];
  const [listed, setListed] = useState(data.listed);
  const [scan, setScan] = useState(data.scan);
  const [looked, setLooked] = useState<string[] | null>(fromUrl);
  const [extra, setExtra] = useState<AnalysisReport | null>(null);
  const [extraBusy, setExtraBusy] = useState(false);

  const missingOutlooks =
    !listed || listed.results.some((r) => !r.error && !r.horizons.length);

  useEffect(() => {
    if (!missingOutlooks) return;
    let cancelled = false;
    void runHorizonAnalysis({ data: { tickers: [...LISTED_STOCKS] } })
      .then((next) => {
        if (!cancelled) setListed(next);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [missingOutlooks]);

  useEffect(() => {
    if (!looked?.length) {
      setExtra(null);
      return;
    }
    let cancelled = false;
    setExtraBusy(true);
    void runHorizonAnalysis({ data: { tickers: looked } })
      .then((next) => {
        if (!cancelled) setExtra(next);
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setExtraBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [looked?.join(",")]);

  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      runRiserScan({ data: {} })
        .then((next) => {
          if (cancelled || !next) return;
          setScan((prev) => {
            if (!prev) return next;
            if (
              next.done === prev.done &&
              next.scanned === prev.scanned &&
              next.pool?.length === prev.pool?.length
            ) {
              return prev;
            }
            return next;
          });
        })
        .catch(() => null);
    void pull();
    const tick = window.setInterval(pull, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, []);

  const report = listed ? padListed(listed, tickers) : skeletonReport(tickers);
  return (
    <HomeView
      report={report}
      scan={scan}
      extra={extra}
      extraBusy={extraBusy}
      onCheck={setLooked}
      onRefresh={() => {
        void runRiserScan({ data: { fresh: true } })
          .then((next) => {
            if (next) setScan(next);
          })
          .catch(() => null);
      }}
    />
  );
}
