import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FlaskConical, Loader2 } from "lucide-react";
import { HardLink } from "@/components/hard-link";
import { BacktestPanel } from "@/components/backtest-panel";
import { LoadingBanner } from "@/components/loading-banner";
import { ScreenHeader } from "@/components/screen-header";
import { TickerPicker } from "@/components/ticker-picker";
import { QUICK_PICKS, useAppStore } from "@/lib/app-store";
import { runBacktest } from "@/lib/analysis/server";

export const Route = createFileRoute("/backtest")({
  validateSearch: (s: Record<string, unknown>): { go?: boolean } =>
    s.go === "1" || s.go === true ? { go: true } : {},
  component: BacktestScreen,
});

function BacktestScreen() {
  const tickers = useAppStore((s) => s.tickers);
  const backtest = useAppStore((s) => s.backtest);
  const error = useAppStore((s) => s.error);
  const loading = useAppStore((s) => s.loadingBacktest);
  const loadingAnalyze = useAppStore((s) => s.loadingAnalyze);
  const loadingScan = useAppStore((s) => s.loadingScan);
  const loadingActions = useAppStore((s) => s.loadingActions);
  const mergeInputToTickers = useAppStore((s) => s.mergeInputToTickers);
  const setError = useAppStore((s) => s.setError);
  const setBacktest = useAppStore((s) => s.setBacktest);
  const setTickers = useAppStore((s) => s.setTickers);
  const setLoading = useAppStore((s) => s.setLoadingBacktest);
  const clearResults = useAppStore((s) => s.clearResults);
  const search = Route.useSearch();

  const busy = loading || loadingAnalyze || loadingScan || loadingActions;

  async function onBacktest() {
    const merged = mergeInputToTickers();
    const finalList = merged.length ? merged : [...QUICK_PICKS];
    setError(null);
    setLoading(true);
    clearResults();
    try {
      const res = await runBacktest({ data: { tickers: finalList } });
      setBacktest(res);
      setTickers(finalList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!search.go || loading || backtest) return;
    void onBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.go]);

  return (
    <div>
      <ScreenHeader
        title="Would it have worked?"
        subtitle="A walk-forward check: pretend we made each month’s 1-month call using only prices knowable that day — including 2020 and 2022 when history exists — then see what actually happened."
      />

      <section className="panel mb-6 space-y-4 p-4 sm:p-5">
        <TickerPicker
          disabled={busy}
          hint={
            tickers.length
              ? undefined
              : "Optional — leave empty to backtest the full Quick pick list."
          }
        />
        <HardLink
          href="/backtest?go=1"
          className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-fg"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Backtesting…
            </>
          ) : (
            <>
              <FlaskConical className="h-5 w-5" />
              Run walk-forward backtest
            </>
          )}
        </HardLink>
        {error && (
          <p className="text-sm text-down" role="alert">
            {error}
          </p>
        )}
      </section>

      {loading && (
        <LoadingBanner title="Walking through years of monthly windows — including 2022 and 2020 when history exists…" />
      )}

      {backtest && !loading && <BacktestPanel report={backtest} />}
    </div>
  );
}
