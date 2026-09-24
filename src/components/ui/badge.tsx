import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium tabular tracking-wide",
  {
    variants: {
      variant: {
        default: "border-border bg-bg-subtle text-fg-muted",
        increase: "border-up/25 bg-up/10 text-up",
        decrease: "border-down/25 bg-down/10 text-down",
        neutral: "border-border bg-bg-subtle text-neutral",
        warn: "border-warn/25 bg-warn/10 text-warn",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
