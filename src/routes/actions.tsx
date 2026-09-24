import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Scale } from "lucide-react";
import { HardLink } from "@/components/hard-link";
import { ActionPanel } from "@/components/action-panel";
import { LoadingBanner } from "@/components/loading-banner";
import { ScreenHeader } from "@/components/screen-header";
import { QUICK_PICKS, useAppStore } from "@/lib/app-store";
import { runActionReview } from "@/lib/analysis/server";

export const Route = createFileRoute("/actions")({
  validateSearch: (s: Record<string, unknown>): { go?: boolean } =>
    s.go === "1" || s.go === true ? { go: true } : {},
  component: ActionsScreen,
});

function ActionsScreen() {
  const actions = useAppStore((s) => s.actions);
  const error = useAppStore((s) => s.error);
  const loading = useAppStore((s) => s.loadingActions);
  const loadingAnalyze = useAppStore((s) => s.loadingAnalyze);
  const loadingScan = useAppStore((s) => s.loadingScan);
  const loadingBacktest = useAppStore((s) => s.loadingBacktest);
  const setError = useAppStore((s) => s.setError);
  const setActions = useAppStore((s) => s.setActions);
  const setLoading = useAppStore((s) => s.setLoadingActions);
  const clearResults = useAppStore((s) => s.clearResults);
  const search = Route.useSearch();

  const busy = loading || loadingAnalyze || loadingScan || loadingBacktest;

  async function onReview() {
    setError(null);
    setLoading(true);
    clearResults();
    try {
      const res = await runActionReview({ data: { tickers: [...QUICK_PICKS] } });
      setActions(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action review failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (actions || loading) return;
    void onReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <ScreenHeader
        title="Add, wait, or reduce"
        subtitle="Rates every name on the one-tap list. Reduce means prefer less exposure — it is not a brokerage sell order."
      />

      <section className="panel mb-6 space-y-4 p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-fg-muted">
          Reviews: {QUICK_PICKS.join(", ")}. The default is wait when the
          picture is mixed. Add only when the short-term setup confirms. Reduce
          is checked first if the next month leans down.
        </p>
        <HardLink
          href="/actions?go=1"
          className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-fg"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Reviewing listed…
            </>
          ) : (
            <>
              <Scale className="h-5 w-5" />
              Review the list
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
        <LoadingBanner title="Reviewing each listed name — add, wait, or reduce…" />
      )}

      {actions && !loading && <ActionPanel report={actions} />}
    </div>
  );
}
