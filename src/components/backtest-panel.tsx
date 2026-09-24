import { DirectionBadge } from "@/components/direction-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BacktestReport, BannerMonth } from "@/lib/analysis/backtest";
import { cn, formatPct, formatUsd } from "@/lib/utils";
import { FlaskConical } from "lucide-react";

function tapeTone(label: string) {
  if (label === "Bear tape") return "text-down";
  if (label === "Bull tape") return "text-up";
  return "text-fg";
}

function BannerYearCard({
  title,
  nMonths,
  nBear,
  nBull,
  nChoppy,
  bearSpyDownRate,
  holdUpBeatSpyInBear,
  holdUpAvgInBear,
  spyAvgInBear,
  listAvgInBear,
}: {
  title: string;
  nMonths: number;
  nBear: number;
  nBull: number;
  nChoppy: number;
  bearSpyDownRate: number | null;
  holdUpBeatSpyInBear: number | null;
  holdUpAvgInBear?: number | null;
  spyAvgInBear?: number | null;
  listAvgInBear?: number | null;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-bg-subtle/40 px-3 py-3">
      <div className="text-xs font-medium text-fg">{title}</div>
      <div className="mt-1 font-mono text-lg tabular text-fg">
        {nBear}/{nMonths} Bear
      </div>
      <div className="mt-0.5 text-xs text-fg-muted">
        {nBull} Bull · {nChoppy} Choppy
      </div>
      <div className="mt-1 text-xs text-fg-muted">
        After a Bear read, SPY fell next month{" "}
        {bearSpyDownRate != null ? `${Math.round(bearSpyDownRate * 100)}%` : "—"} of the time
      </div>
      <div className="mt-0.5 text-xs text-fg-muted">
        “Sleep well” list beat SPY{" "}
        {holdUpBeatSpyInBear != null ? `${Math.round(holdUpBeatSpyInBear * 100)}%` : "—"} of Bear months
      </div>
      {holdUpAvgInBear != null && spyAvgInBear != null && (
        <div className="mt-0.5 text-[11px] text-fg-subtle">
          Avg next month: sleep-well {formatPct(holdUpAvgInBear)} vs SPY {formatPct(spyAvgInBear)}
        </div>
      )}
      {listAvgInBear != null && (
        <div className="mt-0.5 text-[11px] text-fg-subtle">
          Own the whole list next month {formatPct(listAvgInBear)} — cash was {listAvgInBear < 0 ? "better" : "worse"}
        </div>
      )}
    </div>
  );
}

function BannerMonthRow({ m }: { m: BannerMonth }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-3 text-xs text-fg-muted whitespace-nowrap">
        {m.decisionDate}
      </td>
      <td className={cn("py-2 pr-3 text-xs font-medium", tapeTone(m.tape))}>{m.tape}</td>
      <td
        className={cn(
          "py-2 pr-3 font-mono tabular text-xs",
          (m.spyReturn ?? 0) < 0 ? "text-down" : "text-up",
        )}
      >
        {formatPct(m.spyReturn)}
      </td>
      <td className="py-2 pr-3 font-mono tabular text-xs">{formatPct(m.holdUpReturn)}</td>
      <td className="py-2 pr-3 font-mono tabular text-xs text-fg-muted">
        {formatPct(m.breakDownReturn)}
      </td>
      <td className="py-2 text-[11px] text-fg-muted">
        {m.holdUpNames.slice(0, 4).join(" · ")}
      </td>
    </tr>
  );
}

function hitLabel(hit: boolean | null) {
  if (hit === true) return { text: "Hit", variant: "increase" as const };
  if (hit === false) return { text: "Miss", variant: "decrease" as const };
  return { text: "—", variant: "neutral" as const };
}

export function BacktestPanel({ report }: { report: BacktestReport }) {
  const s = report.summary;
  const tableRows = report.latestRows?.length
    ? report.latestRows
    : report.rows.filter((r) => r.period === 0);

  return (
    <div className="fade-in space-y-6">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-fg-muted" />
                History check
              </CardTitle>
              <CardDescription>
                Walk-forward 1-month calls vs what actually happened
                {report.decisionDate
                  ? ` · latest window ${report.decisionDate} → ${report.evalDate}`
                  : ""}
              </CardDescription>
            </div>
            <Badge variant="default">
              {s.n} checks · {report.universe.length} symbols
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: "When 70%+ sure of a rise, how often it rose",
                value: s.hit70 != null ? `${(s.hit70 * 100).toFixed(0)}%` : "—",
                sub: `${s.n70 ?? 0} high-confidence rise calls`,
              },
              {
                label: "Rise calls that beat the market",
                value:
                  s.beatSpyRate != null ? `${(s.beatSpyRate * 100).toFixed(0)}%` : "—",
                sub: "After a small cost vs SPY",
              },
              {
                label: "When it said Rise, how often it rose",
                value:
                  s.increaseHitRate != null
                    ? `${(s.increaseHitRate * 100).toFixed(0)}%`
                    : "—",
                sub: `${s.nIncrease ?? 0} rise calls`,
              },
              {
                label: "How often the up/down call was right",
                value:
                  s.directionalHitRate != null
                    ? `${(s.directionalHitRate * 100).toFixed(0)}%`
                    : "—",
                sub: `${s.nDirectional} times it picked a side`,
              },
              {
                label: "Did higher scores mean higher returns?",
                value: s.scoreReturnCorr != null ? s.scoreReturnCorr.toFixed(2) : "—",
                sub: "Closer to 0 means a weaker link",
              },
              {
                label: "Average move after a “rise” call",
                value: formatPct(s.avgReturnWhenIncrease),
                sub: "Equal weight on each name",
              },
              {
                label: "Rise calls minus fall calls",
                value: formatPct(s.longShortSpread),
                sub: "Positive means the split helped",
              },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-[var(--radius-md)] border border-border bg-bg-subtle/40 px-3 py-3"
              >
                <div className="text-xs text-fg-muted">
                  {m.label}
                </div>
                <div className="mt-1 font-mono text-lg tabular text-fg">{m.value}</div>
                <div className="mt-0.5 text-xs text-fg-muted">{m.sub}</div>
              </div>
            ))}
          </div>

          {s.regimes?.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
                30-day accuracy — bull vs bear
              </h4>
              <p className="mb-2 text-sm leading-relaxed text-fg-muted">
                Each check is a ~30-day (21 trading day) hold from that date, using only
                prices knowable then. Bull-tape months vs bear-tape months vs the 2022
                bear year and the 2023–24 bull years.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {s.regimes.map((rg) => (
                  <div
                    key={rg.label}
                    className="rounded-[var(--radius-md)] border border-border bg-bg-subtle/40 px-3 py-3"
                  >
                    <div className="text-xs font-medium text-fg">{rg.label}</div>
                    <div className="mt-1 font-mono text-lg tabular text-fg">
                      {rg.increaseHitRate != null
                        ? `${(rg.increaseHitRate * 100).toFixed(0)}%`
                        : "—"}
                    </div>
                    <div className="mt-0.5 text-xs text-fg-muted">
                      {rg.nIncrease
                        ? `${rg.nIncrease} rise calls rose a month later`
                        : "No rise calls — it sat out"}
                    </div>
                    {rg.n70 > 0 && (
                      <div className="mt-0.5 text-xs text-fg-muted">
                        70%+ : {rg.hit70 != null ? `${(rg.hit70 * 100).toFixed(0)}%` : "—"} of{" "}
                        {rg.n70}
                      </div>
                    )}
                    <div className="mt-0.5 text-[11px] text-fg-subtle">
                      {rg.from} → {rg.to}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {s.banner && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                Weather banner test v2 — 2022 retest
              </h4>
              <p className="text-sm leading-relaxed text-fg-muted">
                Changed after v1 stuck through bounce months. Bear tape now only if SPY is
                below both the 50-day and the 200-day, the last month is still down, and
                fear or credit is still stressed. Hold-ups are metals plus the calmer
                names — not last quarter’s winners.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <BannerYearCard
                  title="2022 · the bear year"
                  nMonths={s.banner.year2022.nMonths}
                  nBear={s.banner.year2022.nBear}
                  nBull={s.banner.year2022.nBull}
                  nChoppy={s.banner.year2022.nChoppy}
                  bearSpyDownRate={s.banner.year2022.bearSpyDownRate}
                  holdUpBeatSpyInBear={s.banner.year2022.holdUpBeatSpyInBear}
                  holdUpAvgInBear={s.banner.year2022.holdUpAvgInBear}
                  spyAvgInBear={s.banner.year2022.spyAvgInBear}
                  listAvgInBear={s.banner.year2022.listAvgInBear}
                />
                <BannerYearCard
                  title="2020 · crash then rebound"
                  nMonths={s.banner.year2020.nMonths}
                  nBear={s.banner.year2020.nBear}
                  nBull={s.banner.year2020.nBull}
                  nChoppy={s.banner.year2020.nChoppy}
                  bearSpyDownRate={s.banner.year2020.bearSpyDownRate}
                  holdUpBeatSpyInBear={s.banner.year2020.holdUpBeatSpyInBear}
                  holdUpAvgInBear={s.banner.year2020.holdUpAvgInBear}
                  spyAvgInBear={s.banner.year2020.spyAvgInBear}
                  listAvgInBear={s.banner.year2020.listAvgInBear}
                />
                <BannerYearCard
                  title="All years in the sample"
                  nMonths={s.banner.nMonths}
                  nBear={s.banner.nBear}
                  nBull={s.banner.nBull}
                  nChoppy={s.banner.nChoppy}
                  bearSpyDownRate={s.banner.bearSpyDownRate}
                  holdUpBeatSpyInBear={s.banner.holdUpBeatSpyInBear}
                  holdUpAvgInBear={s.banner.holdUpAvgInBear}
                  spyAvgInBear={s.banner.spyAvgInBear}
                />
              </div>
              {s.banner.year2022.months.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
                    Every 2022 month
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-y border-border text-[11px] uppercase tracking-wider text-fg-muted">
                          <th className="py-2 pr-3 font-medium">Decision</th>
                          <th className="py-2 pr-3 font-medium">Banner</th>
                          <th className="py-2 pr-3 font-medium">SPY next month</th>
                          <th className="py-2 pr-3 font-medium">Hold-ups</th>
                          <th className="py-2 pr-3 font-medium">Break-downs</th>
                          <th className="py-2 font-medium">Who held up</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...s.banner.year2022.months]
                          .slice()
                          .sort((a, b) => a.decisionDate.localeCompare(b.decisionDate))
                          .map((m) => (
                          <BannerMonthRow key={m.decisionDate} m={m} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {report.periods?.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
                Latest 12 of {report.periods.length} monthly windows
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-y border-border text-[11px] uppercase tracking-wider text-fg-muted">
                      <th className="py-2 pr-3 font-medium">Window</th>
                      <th className="py-2 pr-3 font-medium">Dates</th>
                      <th className="py-2 pr-3 font-medium">Hit rate</th>
                      <th className="py-2 pr-3 font-medium">Corr</th>
                      <th className="py-2 font-medium">Inc avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.periods.slice(0, 12).map((p) => (
                      <tr key={p.period} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-mono text-xs">T−{p.period}</td>
                        <td className="py-2 pr-3 text-xs text-fg-muted">
                          {p.decisionDate} → {p.evalDate}
                        </td>
                        <td className="py-2 pr-3 font-mono tabular">
                          {p.directionalHitRate != null
                            ? `${(p.directionalHitRate * 100).toFixed(0)}%`
                            : "—"}
                          <span className="text-fg-muted">
                            {" "}
                            ({p.nDirectional})
                          </span>
                        </td>
                        <td className="py-2 pr-3 font-mono tabular text-fg-muted">
                          {p.scoreReturnCorr != null ? p.scoreReturnCorr.toFixed(2) : "—"}
                        </td>
                        <td className="py-2 font-mono tabular">
                          {formatPct(p.avgReturnWhenIncrease)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {s.notes?.length > 0 && (
            <ul className="space-y-1 text-sm text-fg-muted">
              {s.notes.slice(0, 4).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Latest window — per symbol</CardTitle>
          <CardDescription>
            Most recent 1-month decision only
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-border bg-bg-subtle/50 text-[11px] uppercase tracking-wider text-fg-muted">
                  <th className="px-4 py-2.5 font-medium sm:px-5">Ticker</th>
                  <th className="px-3 py-2.5 font-medium">Px decision</th>
                  <th className="px-3 py-2.5 font-medium">Px eval</th>
                  <th className="px-3 py-2.5 font-medium">Actual</th>
                  <th className="px-3 py-2.5 font-medium">1M call</th>
                  <th className="px-3 py-2.5 font-medium">Conf</th>
                  <th className="px-3 py-2.5 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => {
                  const hit = hitLabel(r.hit);
                  return (
                    <tr
                      key={`${r.ticker}-${r.period}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-3 font-mono font-semibold sm:px-5">
                        {r.ticker}
                      </td>
                      <td className="px-3 py-3 font-mono tabular text-fg-muted">
                        {formatUsd(r.priceAtDecision)}
                      </td>
                      <td className="px-3 py-3 font-mono tabular text-fg-muted">
                        {formatUsd(r.priceAtEval)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 font-mono tabular",
                          r.actualReturn > 0
                            ? "text-up"
                            : r.actualReturn < 0
                              ? "text-down"
                              : "text-fg-muted",
                        )}
                      >
                        {formatPct(r.actualReturn)}
                      </td>
                      <td className="px-3 py-3">
                        <DirectionBadge direction={r.forecastDirection} />
                      </td>
                      <td className="px-3 py-3 font-mono tabular text-fg-muted">
                        {r.forecastConfidence}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={hit.variant}>{hit.text}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-fg-muted">
        Educational only — not investment advice. A backtest, even across bull and
        bear years, does not prove future edge. Costs, slippage, and regime
        changes still apply.
      </p>
    </div>
  );
}
