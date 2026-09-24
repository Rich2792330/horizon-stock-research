import { useState } from "react";
import {
  ChevronDown,
  AlertTriangle,
  Shield,
  MessageSquare,
  Landmark,
} from "lucide-react";
import { OutlookCell, CompactTriple } from "@/components/horizon-call";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatMoney, formatPct, formatAsOf } from "@/lib/utils";
import type { AnalysisReport, TickerAnalysis } from "@/lib/analysis/types";
import { displayTicker, displayTickerHint, identityFor, compareLikelyRise } from "@/lib/analysis/listed";
import { formatTapeLine } from "@/lib/analysis/tape-regime";

function horizonOf(r: TickerAnalysis, hz: "1m" | "3m" | "6m") {
  return r.horizons.find((h) => h.horizon === hz);
}

function TickerMark({
  ticker,
  rank,
  name,
  industry,
}: {
  ticker: string;
  rank?: number | null;
  name?: string | null;
  industry?: string | null;
}) {
  const hint = displayTickerHint(ticker);
  const id = identityFor(ticker, { name, industry });
  return (
    <div className="min-w-0 leading-tight">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[12px] font-semibold tracking-wide text-fg">
          {displayTicker(ticker)}
        </span>
        {id.name && (
          <span className="truncate text-[12px] text-fg">{id.name}</span>
        )}
      </div>
      {hint && <div className="text-[10px] text-fg-muted">{hint}</div>}
      {id.industry && (
        <div className="truncate text-[10px] text-fg-muted">{id.industry}</div>
      )}
      {rank != null && (
        <div className="text-[11px] text-fg-subtle">Vs its industry: rank {rank}</div>
      )}
    </div>
  );
}

function priceLabel(analysis: TickerAnalysis): string | null {
  if (!analysis.snapshot) return null;
  return formatMoney(analysis.snapshot.price, analysis.snapshot.currency || "USD");
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(((score + 1) / 2) * 100);
  const color =
    score > 0.12 ? "bg-up" : score < -0.12 ? "bg-down" : "bg-fg-subtle";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", color)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function TickerDetail({ analysis }: { analysis: TickerAnalysis }) {
  const [open, setOpen] = useState(false);
  const s = analysis.snapshot;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-9 w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-subtle/60"
      >
        <div className="min-w-0">
          <span className="font-mono text-[12px] font-semibold tracking-wide text-fg">
            {displayTicker(analysis.ticker)}
          </span>
          {(() => {
            const id = identityFor(analysis.ticker, s);
            return (
              <span className="ml-1.5 text-[12px] text-fg-muted">
                {id.name}
                {id.industry ? ` · ${id.industry}` : ""}
              </span>
            );
          })()}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-fg-muted transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && !analysis.error && (
        <div className="space-y-5 border-t border-border bg-bg/40 px-4 py-4 sm:px-5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <OutlookCell label="1-month outlook" h={horizonOf(analysis, "1m")} />
            <OutlookCell label="3-month outlook" h={horizonOf(analysis, "3m")} />
            <OutlookCell label="6-month outlook" h={horizonOf(analysis, "6m")} />
          </div>
          {analysis.horizons.some((h) => h.confidence > 60 && h.whyConfident) && (
            <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
              <h4 className="mb-2 text-sm font-medium text-fg">
                Why confidence is over 60%
              </h4>
              <div className="space-y-2 text-sm leading-relaxed text-fg">
                {analysis.horizons
                  .filter((h) => h.confidence > 60 && h.whyConfident)
                  .map((h) => (
                    <p key={h.horizon}>{h.whyConfident}</p>
                  ))}
              </div>
            </div>
          )}
          {s && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Last 5 days", v: formatPct(s.ret5d) },
                { label: "Last month", v: formatPct(s.ret21d) },
                { label: "Last quarter", v: formatPct(s.ret63d) },
                { label: "Vs the market (month)", v: formatPct(s.relSpy21d) },
                { label: "Momentum gauge (RSI)", v: s.rsi14?.toFixed(0) ?? "—" },
                { label: "About P/E", v: s.peApprox?.toFixed(1) ?? "—" },
                { label: "Return on equity", v: s.roe != null ? formatPct(s.roe) : "—" },
                {
                  label: "Accounting quality",
                  v:
                    s.quality?.accrualsProxy != null
                      ? s.quality.accrualsProxy.toFixed(2)
                      : "—",
                },
              ].map((cell) => (
                <div
                  key={cell.label}
                  className="rounded-[var(--radius-md)] border border-border bg-bg-elevated px-3 py-2"
                >
                  <div className="text-xs text-fg-muted">{cell.label}</div>
                  <div className="mt-0.5 font-mono text-sm tabular text-fg">{cell.v}</div>
                </div>
              ))}
            </div>
          )}

          {s?.social && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
                  <MessageSquare className="h-4 w-4 text-fg-muted" />
                  Investor posts
                </div>
                <p className="text-sm text-fg">
                  {s.social.stocktwits.bullish} upbeat · {s.social.stocktwits.bearish}{" "}
                  downbeat · {s.social.stocktwits.sampleCount} posts
                </p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
                  <MessageSquare className="h-4 w-4 text-fg-muted" />
                  X chatter
                </div>
                <p className="text-sm text-fg">
                  {s.social.x?.bullish ?? 0} upbeat · {s.social.x?.bearish ?? 0} downbeat ·{" "}
                  {s.social.x?.sampleCount ?? 0} items
                </p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
                  <MessageSquare className="h-4 w-4 text-fg-muted" />
                  Reddit-related
                </div>
                <p className="text-sm text-fg">
                  {s.social.reddit.bullish} upbeat · {s.social.reddit.bearish} downbeat ·{" "}
                  {s.social.reddit.sampleCount} items
                </p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
                  <Landmark className="h-4 w-4 text-fg-muted" />
                  BlackRock / key people
                </div>
                <p className="text-sm text-fg">
                  {s.social.money?.bullish ?? 0} buy/inflow-leaning ·{" "}
                  {s.social.money?.bearish ?? 0} sell/outflow-leaning ·{" "}
                  {s.social.money?.sampleCount ?? 0} headlines
                </p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4 sm:col-span-2">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
                  <Landmark className="h-4 w-4 text-fg-muted" />
                  Policy headlines · market dates
                </div>
                <p className="text-sm text-fg">
                  {s.social.political.bullish} constructive · {s.social.political.bearish}{" "}
                  adverse · {s.social.political.sampleCount} headlines
                </p>
                {s.nextEvent && (
                  <p className="mt-2 text-sm text-fg-muted">Next date: {s.nextEvent}</p>
                )}
              </div>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-medium text-fg">What was scored</h4>
            <div className="space-y-3">
              {analysis.modules
                .filter((m) => m.id !== "risk")
                .map((m) => (
                  <div key={m.id}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                      <span className="text-fg">{m.label}</span>
                      <span className="font-mono text-xs tabular text-fg-muted">
                        {m.score >= 0 ? "+" : ""}
                        {m.score.toFixed(2)}
                      </span>
                    </div>
                    <ScoreBar score={m.score} />
                    <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                      {m.notes.slice(0, 2).join(" · ")}
                    </p>
                  </div>
                ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
                <Shield className="h-4 w-4 text-fg-muted" />
                Risk
              </div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-fg-muted">
                {analysis.risk.riskNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-border bg-bg-elevated p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
                <AlertTriangle className="h-4 w-4 text-fg-muted" />
                If things go badly
              </div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-fg-muted">
                {analysis.risk.stressScenarios.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ResultsPanel({ report }: { report: AnalysisReport }) {
  const abstains = report.abstainNotes;
  const rows = [...report.results].sort(compareLikelyRise);
  const tape = report.tape;
  const bear = tape?.label === "Bear tape";
  const pause1m = Boolean(bear && tape?.suppressRiseCalls);

  return (
    <div className="space-y-6">
      {tape && (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle
              className={cn(
                tape.label === "Bear tape" && "text-down",
                tape.label === "Bull tape" && "text-up",
              )}
            >
              {tape.label}
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed">
              {formatTapeLine(tape)}
            </CardDescription>
          </CardHeader>
          {bear && (
            <CardContent className="space-y-3 pt-0">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Holding up
                </div>
                <p className="mt-1 text-sm text-fg">
                  {tape.holdUp.length
                    ? tape.holdUp.map((x) => `${x.name} (${x.ticker})`).join(" · ")
                    : "—"}
                </p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  Breaking down
                </div>
                <p className="mt-1 text-sm text-fg">
                  {tape.breakDown.length
                    ? tape.breakDown.map((x) => `${x.name} (${x.ticker})`).join(" · ")
                    : "—"}
                </p>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                  What would flip it bullish
                </div>
                <p className="mt-1 text-sm text-fg-muted">
                  {tape.flipBack.join(" · ") || "SPY back above its 50-day and 200-day with calm fear and credit."}
                </p>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <CardTitle>Results</CardTitle>
              <CardDescription>
                {pause1m
                  ? `1-month rise calls paused · ${report.results.length} names · `
                  : `Strongest next-month rise calls first · ${report.results.length} names · `}
                {formatAsOf(report.asOf)}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 px-0 pb-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => {
              if (r.error || !r.horizons.length) {
                return (
                  <li key={r.ticker} className="px-3 py-1.5">
                    <TickerMark
                      ticker={r.ticker}
                      name={r.snapshot?.name}
                      industry={r.snapshot?.industry ?? r.snapshot?.sector}
                    />
                    <p className={`mt-1 text-[11px] ${r.error ? "text-down" : "text-fg-muted"}`}>
                      {r.error ?? "Checking this name…"}
                    </p>
                  </li>
                );
              }
              const h1 = horizonOf(r, "1m");
              const h3 = horizonOf(r, "3m");
              const h6 = horizonOf(r, "6m");
              return (
                <li key={r.ticker} className="px-3 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <TickerMark
                      ticker={r.ticker}
                      name={r.snapshot?.name}
                      industry={r.snapshot?.industry ?? r.snapshot?.sector}
                    />
                    {priceLabel(r) && (
                      <div className="shrink-0 text-[11px] tabular text-fg-muted">{priceLabel(r)}</div>
                    )}
                  </div>
                  <CompactTriple h1={h1} h3={h3} h6={h6} />
                </li>
              );
            })}
          </ul>
          <p className="border-t border-border px-3 py-2 text-xs leading-relaxed text-fg-muted sm:px-4">
            Each name shows next month, 3 months, and 6 months: Rise / Fall /
            Even, the expected % move, and how sure the model is. Sit out means
            there is no 1-month rise call — not a hidden +20% forecast.
          </p>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm">Numbers behind each name</CardTitle>
          <CardDescription>Tap only if you want the extra detail</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-hidden rounded-b-[var(--radius-xl)]">
            {rows.map((r) => (
              <TickerDetail key={r.ticker} analysis={r} />
            ))}
          </div>
        </CardContent>
      </Card>

      {abstains.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Where the system held back</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-fg-muted">
              {abstains.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-fg-muted">
        Educational research only — not investment advice. Most short-horizon
        forecasts have limited edge after costs. Do your own homework.
      </p>
    </div>
  );
}
