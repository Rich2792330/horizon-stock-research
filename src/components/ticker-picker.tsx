import { useState } from "react";
import { X } from "lucide-react";
import { HardLink } from "@/components/hard-link";
import { Input } from "@/components/ui/input";
import { QUICK_PICKS, useAppStore } from "@/lib/app-store";
import { displayTicker } from "@/lib/analysis/listed";
import { cn, parseTickers } from "@/lib/utils";

const chipClass =
  "flex min-h-14 w-full items-center justify-center rounded-xl border border-border bg-bg-subtle px-1 text-center font-mono text-sm font-semibold tracking-wide text-fg active:bg-bg-elevated sm:text-base";

export function TickerPicker({
  disabled,
  hint,
  asCheckLinks = false,
}: {
  disabled?: boolean;
  hint?: string;
  asCheckLinks?: boolean;
}) {
  const rawInput = useAppStore((s) => s.rawInput);
  const tickers = useAppStore((s) => s.tickers);
  const setRawInput = useAppStore((s) => s.setRawInput);
  const setTickers = useAppStore((s) => s.setTickers);
  const removeTicker = useAppStore((s) => s.removeTicker);
  const clearTickers = useAppStore((s) => s.clearTickers);
  const addTicker = useAppStore((s) => s.addTicker);

  const preview = parseTickers(rawInput);

  return (
    <div className="space-y-4">
      {!asCheckLinks && (
        <div>
          <label htmlFor="tickers" className="mb-2 block text-sm font-medium text-fg">
            Type a stock or ETF symbol
          </label>
          <Input
            id="tickers"
            name="q"
            value={rawInput}
            disabled={disabled}
            onChange={(e) => setRawInput(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "," || e.key === " ") && rawInput.trim()) {
                e.preventDefault();
                const next = parseTickers([...tickers, ...preview].join(" "));
                setTickers(next);
                setRawInput("");
              }
              if (e.key === "Backspace" && !rawInput && tickers.length) {
                removeTicker(tickers[tickers.length - 1]!);
              }
            }}
            placeholder="Example: NVDA"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            className="font-mono uppercase tracking-wide"
          />
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            {hint ?? "Type a symbol, or tap a name below."}
          </p>
        </div>
      )}

      {asCheckLinks && (
        <div>
          <label htmlFor="tickers" className="mb-2 block text-sm font-medium text-fg">
            Type a stock or ETF symbol
          </label>
          <form method="get" action="/" className="flex gap-2">
            <Input
              id="tickers"
              name="q"
              defaultValue=""
              placeholder="NVDA"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              inputMode="text"
              autoCapitalize="characters"
              className="font-mono uppercase tracking-wide"
            />
            <button
              type="submit"
              className="inline-flex min-h-12 min-w-20 shrink-0 items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-fg"
            >
              Check
            </button>
          </form>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            {hint ?? "Tap a name. It loads a full check for that symbol."}
          </p>
        </div>
      )}

      {(tickers.length > 0 || preview.length > 0) && !asCheckLinks && (
        <div className="flex flex-wrap gap-2">
          {tickers.map((t) => (
            <span
              key={t}
              className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border bg-bg-subtle pl-3 pr-1 font-mono text-sm tracking-wide text-fg"
            >
              {t}
              <button
                type="button"
                disabled={disabled}
                onClick={() => removeTicker(t)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-fg-muted"
                aria-label={`Remove ${t}`}
              >
                <X className="h-4 w-4" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-muted">
          Tap a name
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {QUICK_PICKS.map((ex) =>
            asCheckLinks ? (
              <HardLink key={ex} href={`/?q=${encodeURIComponent(ex)}`} className={chipClass}>
                {displayTicker(ex)}
              </HardLink>
            ) : (
              <button
                key={ex}
                type="button"
                disabled={disabled}
                onClick={() => addTicker(ex)}
                className={cn(chipClass, tickers.includes(ex) && "border-fg text-fg")}
              >
                {displayTicker(ex)}
              </button>
            ),
          )}
        </div>
        {tickers.length > 0 && !asCheckLinks && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => clearTickers()}
            className="mt-3 min-h-11 text-sm text-fg-muted"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}

/** Compact iPhone lookup — type a symbol, tap Check. */
export function TickerLookup({
  busy,
  onCheck,
}: {
  busy?: boolean;
  onCheck: (tickers: string[]) => void;
}) {
  const [raw, setRaw] = useState("");
  return (
    <form
      className="panel mb-3 space-y-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const next = parseTickers(raw);
        if (!next.length) return;
        onCheck(next);
      }}
    >
      <label htmlFor="lookup" className="block text-[12px] font-medium text-fg">
        Look up a ticker
      </label>
      <div className="flex gap-2">
        <Input
          id="lookup"
          value={raw}
          disabled={busy}
          onChange={(e) => setRaw(e.target.value.toUpperCase())}
          placeholder="NVDA  AMZN  MSFT"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          autoCapitalize="characters"
          className="h-11 font-mono text-[15px] uppercase tracking-wide"
        />
        <button
          type="submit"
          disabled={busy || !raw.trim()}
          className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-fg disabled:opacity-50"
        >
          {busy ? "…" : "Check"}
        </button>
      </div>
      <p className="text-[11px] leading-snug text-fg-muted">
        Type one or more symbols. Your 21 names stay on this screen.
      </p>
    </form>
  );
}
