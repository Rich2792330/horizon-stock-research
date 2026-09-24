import { Loader2 } from "lucide-react";

export function LoadingBanner({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}) {
  return (
    <div className="panel fade-in mb-6 p-5">
      <div className="flex items-start gap-3">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-fg" />
        <div>
          <p className="text-sm font-medium text-fg">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-fg-muted">
            {detail ?? "This usually takes a short while. Leave this page open."}
          </p>
        </div>
      </div>
    </div>
  );
}
