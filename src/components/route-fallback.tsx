import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="panel mx-auto max-w-lg space-y-4 p-6">
      <h1 className="font-display text-2xl font-semibold text-fg">Page not found</h1>
      <p className="text-sm leading-relaxed text-fg-muted">
        That screen is not in this app. Go back to Check a stock and start from
        there.
      </p>
      <Button asChild>
        <Link to="/">Check a stock</Link>
      </Button>
    </div>
  );
}

export function RouteError({ error }: ErrorComponentProps) {
  return (
    <div className="panel mx-auto max-w-lg space-y-4 p-6">
      <h1 className="font-display text-2xl font-semibold text-fg">Something broke</h1>
      <p className="text-sm leading-relaxed text-fg-muted">
        The app hit an error loading this screen. You can go back and try again —
        your list of symbols is still on Check a stock.
      </p>
      {error?.message ? (
        <p className="rounded-[var(--radius-md)] bg-bg-subtle px-3 py-2 font-mono text-xs text-fg-muted">
          {error.message}
        </p>
      ) : null}
      <Button asChild>
        <Link to="/">Back to Check a stock</Link>
      </Button>
    </div>
  );
}
