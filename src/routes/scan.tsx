import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ResultsPanel } from "@/components/results-panel";
import { ScreenHeader } from "@/components/screen-header";
import { TopRisers } from "@/components/top-risers";
import { LISTED_STOCKS } from "@/lib/analysis/listed";
import { loadHomeDesk, runHorizonAnalysis, runRiserScan } from "@/lib/analysis/server";
import type { RiserScanReport } from "@/lib/analysis/scan";
import type { AnalysisReport, TickerAnalysis } from "@/lib/analysis/types";

function emptyRow(ticker: string): TickerAnalysis {
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
  };
}

function pad(report: AnalysisReport | null): AnalysisReport {
  const wanted = [...LISTED_STOCKS];
  const by = new Map((report?.results ?? []).map((r) => [r.ticker, r]));
  const results = wanted.map((t) => by.get(t) ?? emptyRow(t));
  return {
    asOf: report?.asOf ?? "2026-01-01T00:00:00.000Z",
    tickers: wanted,
    results,
    overallMethodology: report?.overallMethodology ?? "",
    keyRisks: report?.keyRisks ?? [],
    abstainNotes: report?.abstainNotes ?? [],
    disclaimer: report?.disclaimer ?? "",
    tape: report?.tape,
  };
}

export const Route = createFileRoute("/scan")({
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
  staleTime: 60_000,
  component: ScanScreen,
});

function ScanScreen() {
  const data = Route.useLoaderData();
  const [scan, setScan] = useState<RiserScanReport | null>(data.scan);
  const [listed, setListed] = useState(data.listed);

  useEffect(() => {
    if (listed && !listed.results.some((r) => !r.error && !r.horizons.length)) return;
    let cancelled = false;
    void runHorizonAnalysis({ data: { tickers: [...LISTED_STOCKS] } })
      .then((next) => {
        if (!cancelled) setListed(next);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [listed]);

  useEffect(() => {
    let cancelled = false;
    const pull = () =>
      runRiserScan({ data: {} })
        .then((next) => {
          if (cancelled || !next) return;
          setScan((prev) => {
            if (!prev) return next;
            if (next.done === prev.done && next.scanned === prev.scanned) return prev;
            return next;
          });
          if (next.done) window.clearInterval(tick);
        })
        .catch(() => null);
    const tick = window.setInterval(pull, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, []);

  return (
    <div>
      <ScreenHeader
        title="70%+ risers"
        subtitle="Finished next-month 70%+ names stay on screen. Your 21 names are below."
      />
      <div className="mb-3">
        <TopRisers scan={scan} updating={scan != null && scan.done === false} />
      </div>
      <ResultsPanel report={pad(listed)} />
    </div>
  );
}
