import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Action, ActionReviewReport } from "@/lib/analysis/action-review";
import { HorizonCall } from "@/components/horizon-call";
import { displayTicker, identityFor } from "@/lib/analysis/listed";
import { cn, formatUsd } from "@/lib/utils";
import type { Direction, Horizon, HorizonForecast } from "@/lib/analysis/types";
import { Scale } from "lucide-react";

function actionVariant(a: Action): "increase" | "decrease" | "neutral" {
  if (a === "Buy") return "increase";
  if (a === "Sell") return "decrease";
  return "neutral";
}

function actionLabel(a: Action): string {
  if (a === "Buy") return "Add";
  if (a === "Sell") return "Reduce";
  return "Wait";
}

function asHorizon(
  hz: Horizon,
  dir: Direction | null,
  conf: number | null,
  expected: number | null,
  lo: number | null,
  hi: number | null,
): HorizonForecast | null {
  if (!dir) return null;
  return {
    horizon: hz,
    label: hz,
    direction: dir,
    confidence: conf ?? 50,
    score: 0,
    abstain: false,
    weights: {},
    drivers: [],
    expectedReturn: expected ?? 0,
    ciLow: lo ?? -0.1,
    ciHigh: hi ?? 0.1,
    ciLevel: 80,
    horizonVol: 0.1,
  };
}

export function ActionPanel({ report }: { report: ActionReviewReport }) {
  const { summary } = report;

  return (
    <div className="fade-in space-y-6">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-fg-muted" />
                Add · wait · reduce
              </CardTitle>
              <CardDescription>
                {new Date(report.asOf).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="increase">Add {summary.buy}</Badge>
              <Badge variant="neutral">Wait {summary.hold}</Badge>
              <Badge variant="decrease">Reduce {summary.sell}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-y border-border bg-bg-subtle/50 text-xs text-fg-muted">
                  <th className="px-4 py-2 font-medium sm:px-5">Ticker</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Price</th>
                  <th className="px-3 py-2 font-medium">1-month</th>
                  <th className="px-3 py-2 font-medium">3-month</th>
                  <th className="px-3 py-2 font-medium">6-month</th>
                  <th className="px-4 py-2 font-medium sm:px-5">Why</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => {
                  const h1 = asHorizon("1m", r.dir1m, r.conf1m, r.expected1m, r.ciLow1m, r.ciHigh1m);
                  const h3 = asHorizon("3m", r.dir3m, r.conf3m, r.expected3m, r.ciLow3m, r.ciHigh3m);
                  const h6 = asHorizon("6m", r.dir6m, r.conf6m, r.expected6m, r.ciLow6m, r.ciHigh6m);
                  return (
                    <tr
                      key={r.ticker}
                      className={cn(
                        "border-b border-border last:border-0",
                        r.action === "Sell" && "bg-down/5",
                        r.action === "Buy" && "bg-up/5",
                      )}
                    >
                      <td className="px-4 py-3 align-top sm:px-5">
                        {(() => {
                          const id = identityFor(r.ticker, {
                            name: r.name,
                            industry: r.industry,
                          });
                          return (
                            <>
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-mono font-semibold tracking-wide text-fg">
                                  {displayTicker(r.ticker)}
                                </span>
                                {id.name && (
                                  <span className="text-sm font-medium text-fg">{id.name}</span>
                                )}
                              </div>
                              {id.industry && (
                                <div className="text-xs text-fg-muted">{id.industry}</div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Badge variant={actionVariant(r.action)}>{actionLabel(r.action)}</Badge>
                      </td>
                      <td className="px-3 py-3 align-top font-mono tabular text-fg-muted">
                        {formatUsd(r.price)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {h1 ? <HorizonCall h={h1} /> : "—"}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {h3 ? <HorizonCall h={h3} /> : "—"}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {h6 ? <HorizonCall h={h6} /> : "—"}
                      </td>
                      <td className="max-w-[240px] px-4 py-3 align-top text-xs leading-relaxed text-fg-muted sm:px-5">
                        {r.error ? <span className="text-down">{r.error}</span> : r.reason}
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
        Educational only — not investment advice. Reduce means prefer less
        exposure. Match that to your own limits and taxes.
      </p>
    </div>
  );
}
