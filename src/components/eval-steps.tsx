import { EVAL_GROUPS, QUANT_WEIGHT_LINES } from "@/lib/eval-steps";

export function EvalSteps({ note }: { note?: string }) {
  let n = 0;
  return (
    <div className="rounded-xl border border-border bg-bg-subtle/40 p-4">
      <p className="mb-3 text-sm font-medium text-fg">Big picture — every stock</p>
      <div className="space-y-4">
        {EVAL_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-fg">
              {group.title}
            </p>
            <ol className="space-y-1.5 text-sm leading-snug text-fg-muted">
              {group.steps.map((step) => {
                n += 1;
                return (
                  <li key={step} className="flex gap-2">
                    <span className="w-5 shrink-0 font-mono text-xs text-fg">{n}.</span>
                    <span>{step}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs font-medium text-fg">How the ranking weights are set</p>
      <ul className="mt-1 space-y-1 text-xs leading-snug text-fg-muted">
        {QUANT_WEIGHT_LINES.map((line) => (
          <li key={line}>• {line}</li>
        ))}
      </ul>
      {note && <p className="mt-3 text-xs leading-relaxed text-fg-subtle">{note}</p>}
    </div>
  );
}
