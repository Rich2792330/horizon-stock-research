import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Full-page link. Bypasses the in-app router so a tap always loads. */
export function HardLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const dest = new URL(href, window.location.href);
    const here = window.location;
    if (dest.pathname === here.pathname && dest.search === here.search) {
      window.location.reload();
      return;
    }
    window.location.assign(dest.pathname + dest.search + dest.hash);
  }

  return (
    <a href={href} className={cn("cursor-pointer", className)} onClick={onClick}>
      {children}
    </a>
  );
}
