import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RiserScanReport } from "@/lib/analysis/scan";
import { formatPct, formatUsd, formatAsOf } from "@/lib/utils";
import { directionShort } from "@/lib/plain-language";
import { identityFor } from "@/lib/analysis/listed";
import { Radar } from "lucide-react";

export function ScanPanel({ report }: { report: RiserScanReport }) {
  const mins =
    report.durationMs != null ? (report.durationMs / 60000).toFixed(1) : null;
  const min = report.minConfidence || 70;
  const hits = report.hits.filter(
    (h) => h.direction === "Increase" && !h.abstain && h.confidence >= min,
  );

  return (
    <div className="fade-in space-y-6">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-fg-muted" />
                Next-month risers at {min}%+ sure
              </CardTitle>
              <CardDescription>
                {report.scanned} symbols
                {mins ? ` · ~${mins} min` : ""} ·{" "}
                {formatAsOf(report.asOf)}
                {report.failed > 0 ? ` · ${report.failed} failed` : ""}
                {` · only ${min}% sure or higher`}
              </CardDescription>
            </div>
            <Badge variant={hits.length ? "increase" : "neutral"}>
              {hits.length} match{hits.length === 1 ? "" : "es"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="min-w-0 px-0 pb-0">
          {hits.length === 0 ? (
            <p className="px-5 py-6 text-sm leading-relaxed text-fg-muted">
              {report.done === false
                ? "Still searching — only names that clear 70% sure will appear."
                : `The search finished. It checked ${report.scanned} names and none were at least ${min}% sure of a next-month rise. That is a completed result. Weaker names are not listed.`}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-y border-border bg-bg-subtle/50 text-xs text-fg-muted">
                    <th className="px-4 py-2 font-medium sm:px-5">Ticker</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Call</th>
                    <th className="px-3 py-2 font-medium">Change</th>
                    <th className="px-3 py-2 font-medium">Range</th>
                    <th className="px-3 py-2 font-medium">Sure</th>
                    <th className="px-4 py-2 font-medium sm:px-5">Why 70%+</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.ticker} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 align-top sm:px-5">
                        {(() => {
                          const id = identityFor(h.ticker, {
                            name: h.name,
                            industry: h.industry ?? h.sector,
                            sector: h.sector,
                          });
                          return (
                            <>
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                                <span className="font-mono font-semibold text-fg">{h.ticker}</span>
                                {id.name && (
                                  <span className="truncate text-sm font-medium text-fg">
                                    {id.name}
                                  </span>
                                )}
                              </div>
                              {id.industry && (
                                <div className="text-xs text-fg-muted">{id.industry}</div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-3 align-top font-mono tabular text-fg-muted">
                        {formatUsd(h.price)}
                      </td>
                      <td className="px-3 py-3 align-top font-medium text-up">
                        {directionShort(h.direction)}
                      </td>
                      <td className="px-3 py-3 align-top font-mono font-semibold tabular text-up">
                        {formatPct(h.expectedReturn)}
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-xs tabular text-fg-muted">
                        {formatPct(h.ciLow)} to {formatPct(h.ciHigh)}
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-base font-semibold tabular text-up">
                        {h.confidence}%
                      </td>
                      <td className="max-w-[420px] px-4 py-3 align-top text-sm leading-relaxed text-fg sm:px-5">
                        {h.whyConfident || h.keyDrivers}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-fg-muted">
        Educational only — not investment advice.
      </p>
    </div>
  );
}
