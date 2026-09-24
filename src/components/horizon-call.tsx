import { cn, formatPct } from "@/lib/utils";
import type { HorizonForecast } from "@/lib/analysis/types";

function toneFor(expected: number, abstain?: boolean) {
  if (abstain) return "text-fg-muted";
  if (expected > 0.002) return "text-up";
  if (expected < -0.002) return "text-down";
  return "text-fg";
}

function callFromExpected(h: HorizonForecast) {
  if (h.abstain) return "Sit";
  const expected = h.expectedReturn ?? 0;
  if (expected > 0.002) return "Rise";
  if (expected < -0.002) return "Fall";
  return "Even";
}

function sitOutWhy(h: HorizonForecast) {
  return (h.abstainReason ?? "No rise call").replace(/^Next month:\s*/i, "");
}

/** One compact cell: 1m Rise +8% 84% */
export function HorizonChip({
  label,
  h,
}: {
  label: string;
  h: HorizonForecast | undefined;
}) {
  if (!h) {
    return <span className="text-[11px] text-fg-subtle">{label} —</span>;
  }
  if (h.abstain) {
    return (
      <span className="text-[11px] text-fg-muted">
        {label} sit
      </span>
    );
  }
  const expected = h.expectedReturn ?? 0;
  return (
    <span className={cn("whitespace-nowrap text-[11px] tabular", toneFor(expected))}>
      {label} {callFromExpected(h)} {formatPct(expected)} · {h.confidence}%
    </span>
  );
}

export function CompactTriple({
  h1,
  h3,
  h6,
}: {
  h1?: HorizonForecast;
  h3?: HorizonForecast;
  h6?: HorizonForecast;
}) {
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
      <HorizonChip label="1m" h={h1} />
      <HorizonChip label="3m" h={h3} />
      <HorizonChip label="6m" h={h6} />
    </div>
  );
}

function OutlookNumbers({ h }: { h: HorizonForecast }) {
  if (h.abstain) {
    return (
      <>
        <div className="text-xs font-semibold text-fg">Sit out</div>
        <div className="text-[11px] leading-snug text-fg-muted">{sitOutWhy(h)}</div>
      </>
    );
  }
  const expected = h.expectedReturn ?? 0;
  const tone = toneFor(expected);
  return (
    <>
      <div className={cn("text-xs font-semibold", tone)}>{callFromExpected(h)}</div>
      <div className={cn("font-mono text-sm font-semibold tabular leading-tight", tone)}>
        {formatPct(expected)}
      </div>
      <div className="text-[11px] font-semibold tabular text-fg">{h.confidence}% sure</div>
    </>
  );
}

export function OutlookCell({
  label,
  h,
}: {
  label: string;
  h: HorizonForecast | undefined;
}) {
  if (!h) {
    return (
      <div className="min-w-0 rounded-md border border-border bg-bg-subtle/40 px-2 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
          {label}
        </div>
        <div className="mt-0.5 text-xs text-fg-muted">No outlook</div>
      </div>
    );
  }
  return (
    <div className="min-w-0 rounded-md border border-border bg-bg-elevated px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        {label}
      </div>
      <div className="mt-0.5">
        <OutlookNumbers h={h} />
      </div>
    </div>
  );
}

export function HorizonMini({ h }: { h: HorizonForecast | undefined }) {
  if (!h) return <div className="text-[11px] text-fg-muted">—</div>;
  return <OutlookNumbers h={h} />;
}

export function HorizonCall({
  h,
}: {
  h: HorizonForecast;
  compact?: boolean;
}) {
  return <OutlookNumbers h={h} />;
}

export function OutlookLine({
  label,
  h,
}: {
  label: string;
  h: HorizonForecast | undefined;
}) {
  if (!h) {
    return (
      <div className="flex items-baseline justify-between gap-2 py-0.5">
        <div className="w-16 shrink-0 text-[11px] text-fg-muted">{label}</div>
        <div className="text-[11px] text-fg-muted">No outlook</div>
      </div>
    );
  }
  if (h.abstain) {
    return (
      <div className="flex items-baseline justify-between gap-2 py-0.5">
        <div className="w-16 shrink-0 text-[11px] text-fg-muted">{label}</div>
        <div className="text-[11px] text-fg-muted">Sit out</div>
      </div>
    );
  }
  const expected = h.expectedReturn ?? 0;
  const tone = toneFor(expected);
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <div className="w-16 shrink-0 text-[11px] text-fg-muted">{label}</div>
      <div className={cn("text-[11px] font-medium tabular", tone)}>
        {callFromExpected(h)} {formatPct(expected)} · {h.confidence}%
      </div>
    </div>
  );
}
