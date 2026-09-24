import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { EvalSteps } from "@/components/eval-steps";
import { HardLink } from "@/components/hard-link";
import { ScreenHeader } from "@/components/screen-header";

export const Route = createFileRoute("/guide")({
  component: GuideScreen,
});

function GuideScreen() {
  return (
    <div>
      <ScreenHeader
        title="How the app works"
        subtitle="Every name on your list, and every finalist in the riser search, goes through the same steps."
      />

      <section className="panel mb-6 p-5 sm:p-6">
        <EvalSteps note="If a data source is missing, that piece is marked limited — the rest still runs." />
      </section>

      <section className="panel mb-6 space-y-3 p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold text-fg">Buttons</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-fg-muted">
          <li>
            <strong className="text-fg">Your list</strong> — opens on a full check of
            the default names
          </li>
          <li>
            <strong className="text-fg">Find likely risers</strong> — opens the
            last finished 70%+ next-month list plus your 21 names. A new look
            runs in the background and does not swap the list until it finishes.
          </li>
          <li>
            <strong className="text-fg">Add, wait, or reduce</strong> — a read on the
            default list
          </li>
          <li>
            <strong className="text-fg">Past tests</strong> — walk-forward 1-month
            calls vs what happened, split by all years, 2020, 2022, and the last
            12 months
          </li>
        </ul>
        <HardLink
          href="/"
          className="mt-2 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-base font-semibold text-primary-fg"
        >
          Open your list
          <ArrowRight className="h-4 w-4" />
        </HardLink>
      </section>

      <p className="text-xs leading-relaxed text-fg-muted">
        For learning and research only — not investment advice. Markets are noisy;
        past patterns do not guarantee future results.
      </p>
    </div>
  );
}
