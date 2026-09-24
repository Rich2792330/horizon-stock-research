import { Badge } from "@/components/ui/badge";
import type { Direction } from "@/lib/analysis/types";
import { directionTitle } from "@/lib/plain-language";

export function DirectionBadge({
  direction,
  confidence,
}: {
  direction: Direction;
  confidence?: number;
}) {
  const variant =
    direction === "Increase"
      ? "increase"
      : direction === "Decrease"
        ? "decrease"
        : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={variant}>{directionTitle(direction)}</Badge>
      {confidence != null && (
        <span className="text-xs tabular text-fg-subtle">{confidence} of 100</span>
      )}
    </div>
  );
}
