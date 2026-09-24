import { useRef } from "react";
import { Radar } from "lucide-react";
import { CompactTriple } from "@/components/horizon-call";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { identityFor } from "@/lib/analysis/listed";
import type { ScanHit, ScanOutlook, RiserScanReport } from "@/lib/analysis/scan";
import { clearedRise70, qualifyingRise, RISER_MIN_CONFIDENCE } from "@/lib/analysis/scan";
import type { Direction, Horizon, HorizonForecast } from "@/lib/analysis/types";
import { cn, formatAsOf } from "@/lib/utils";

function asHorizon(
  label: string,
  horizon: Horizon,
  src: {
    direction: Direction;
    confidence: number;
    expectedReturn: number;
    abstain: boolean;
    whyConfident?: string;
  },
): HorizonForecast {
  return {
    horizon,
    label,
    direction: src.direction,
    confidence: src.confidence,
    score: 0,
    abstain: src.abstain,
    expectedReturn: src.expectedReturn,
    ciLow: src.expectedReturn,
    ciHigh: src.expectedReturn,
    ciLevel: 80,
    horizonVol: 0,
    weights: {},
    drivers: [],
    whyConfident: src.whyConfident,
  };
}

function fromHit(h: ScanHit): HorizonForecast {
  return asHorizon("Next month", "1m", h);
}

function fromOut(label: string, hz: Horizon, o?: ScanOutlook): HorizonForecast | undefined {
  return o ? asHorizon(label, hz, o) : undefined;
}

function hitsOf(scan: RiserScanReport | null): ScanHit[] {
  const min = scan?.minConfidence ?? RISER_MIN_CONFIDENCE;
  return [...(scan?.hits ?? [])]
    .filter((h) => qualifyingRise(h, min))
    .sort(
      (a, b) =>
        b.expectedReturn - a.expectedReturn ||
        clearedRise70(b, min) - clearedRise70(a, min),
    )
    .slice(0, 12);
}

function progressOf(scan: RiserScanReport | null): {
  scanned: number;
  total: number;
  pct: number;
  done: boolean;
} {
  const total = Math.max(1, scan?.universeSize ?? 0);
  const scanned = Math.max(0, Math.min(total, scan?.scanned ?? 0));
  const done = scan?.done === true || scan?.phase === "done";
  return { scanned, total, pct: Math.round((scanned / total) * 100), done };
}

function NameRow({ h }: { h: ScanHit }) {
  const id = identityFor(h.ticker, {
    name: h.name,
    industry: h.industry ?? h.sector,
    sector: h.sector,
  });
  return (
    <li className="py-1.5">
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="font-mono text-[12px] font-semibold tracking-wide text-fg">{h.ticker}</span>
        {id.name && <span className="truncate text-[12px] text-fg">{id.name}</span>}
      </div>
      {id.industry && <div className="truncate text-[10px] text-fg-muted">{id.industry}</div>}
      <CompactTriple
        h1={fromHit(h)}
        h3={fromOut("3m", "3m", h.h3)}
        h6={fromOut("6m", "6m", h.h6)}
      />
    </li>
  );
}

export function TopRisers({
  scan,
  updating,
  onRefresh,
}: {
  scan: RiserScanReport | null;
  updating?: boolean;
  pauseReason?: string | null;
  onRefresh?: () => void;
}) {
  const min = scan?.minConfidence ?? 70;
  const liveHits = hitsOf(scan);
  const held = useRef<ScanHit[]>([]);
  if (liveHits.length) held.current = liveHits;
  const hits = liveHits.length ? liveHits : held.current;
  const prog = progressOf(scan);
  const running = Boolean(updating || (scan && !prog.done));
  const when = scan?.asOf ? formatAsOf(scan.asOf) : "";

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5">
            <Radar className="h-3.5 w-3.5 text-fg-muted" />
            70%+ next month
          </CardTitle>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-fg"
            >
              {running ? "Updating" : "Update"}
            </button>
          )}
        </div>
        <CardDescription>
          {running
            ? `Updating ${prog.scanned.toLocaleString()} / ${prog.total.toLocaleString()}${when ? ` · last look ${when}` : ""}`
            : `Last look ${when || "—"} · ${prog.scanned.toLocaleString()} / ${prog.total.toLocaleString()}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="px-3 pb-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
            <div
              className={cn("h-full rounded-full transition-[width] duration-300", prog.done ? "bg-fg" : "bg-up")}
              style={{ width: `${prog.done ? 100 : Math.max(prog.pct, running ? 4 : 0)}%` }}
            />
          </div>
        </div>

        {hits.length > 0 ? (
          <ul className="divide-y divide-border border-t border-border px-3">
            {hits.map((h) => (
              <NameRow key={h.ticker} h={h} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-border px-3 py-2 text-[11px] leading-snug text-fg-muted">
            {prog.done
              ? `No name cleared ${min}% sure to rise next month.`
              : "Scores stay on this screen. The bar above is the only thing that moves."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
