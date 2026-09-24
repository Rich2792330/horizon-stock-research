import { useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  FlaskConical,
  LineChart,
  Radar,
  Scale,
} from "lucide-react";
import { HardLink } from "@/components/hard-link";
import { cn } from "@/lib/utils";

const NAV = [
  {
    to: "/",
    label: "Analyze",
    short: "Analyze",
    hint: "Your default list",
    icon: LineChart,
    match: (p: string) => p === "/",
  },
  {
    to: "/scan",
    label: "Find risers",
    short: "Risers",
    hint: "70%+ next month",
    icon: Radar,
    match: (p: string) => p.startsWith("/scan"),
  },
  {
    to: "/actions",
    label: "Buy or sell",
    short: "Actions",
    hint: "Listed names",
    icon: Scale,
    match: (p: string) => p.startsWith("/actions"),
  },
  {
    to: "/backtest",
    label: "Past tests",
    short: "Tests",
    hint: "Would it have worked?",
    icon: FlaskConical,
    match: (p: string) => p.startsWith("/backtest"),
  },
  {
    to: "/guide",
    label: "How it works",
    short: "Guide",
    hint: "Plain-English steps",
    icon: BookOpen,
    match: (p: string) => p.startsWith("/guide"),
  },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = NAV.find((n) => n.match(pathname));

  return (
    <div className="app-shell flex min-h-dvh flex-col bg-bg md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-bg-elevated md:flex">
        <div className="flex items-center gap-3 border-b border-border px-5 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-primary-fg">
            <Scale className="h-4 w-4" />
          </div>
          <div>
            <div className="font-display text-lg font-semibold tracking-tight text-fg">
              Horizon
            </div>
            <div className="text-xs text-fg-muted">Clear stock research</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <HardLink
                key={item.to}
                href={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors duration-[var(--motion-quick)]",
                  active
                    ? "bg-bg-subtle text-fg"
                    : "text-fg-muted hover:bg-bg-subtle/60 hover:text-fg",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="text-xs font-normal text-fg-subtle">{item.hint}</span>
                </span>
              </HardLink>
            );
          })}
        </nav>
        <div className="border-t border-border p-4 text-xs leading-relaxed text-fg-muted">
          For learning and research only — not investment advice.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 border-b border-border bg-bg/90 px-3 py-2 backdrop-blur-md md:hidden"
          style={{ paddingTop: "max(0.4rem, env(safe-area-inset-top, 0px))" }}
        >
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-primary-fg">
              <Scale className="h-3 w-3" />
            </div>
            <div>
              <div className="text-[13px] font-semibold tracking-tight text-fg">
                Horizon
              </div>
              <div className="text-[10px] text-fg-muted">
                {current?.label ?? "App"}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-3 pb-24 pt-3 sm:px-6 sm:pt-6 md:pb-12">
          {children}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg-elevated/95 backdrop-blur-md md:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {NAV.map((item) => {
              const active = item.match(pathname);
              const Icon = item.icon;
              return (
                <HardLink
                  key={item.to}
                  href={item.to}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold",
                    active ? "text-fg" : "text-fg-muted",
                  )}
                >
                  <Icon className={cn("h-5 w-5", active ? "text-fg" : "text-fg-muted")} />
                  {item.short}
                </HardLink>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
