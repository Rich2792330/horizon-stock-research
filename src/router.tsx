import { createRouter } from "@tanstack/react-router";
import { NotFoundPage, RouteError } from "@/components/route-fallback";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouteError,
    defaultPendingMs: 60_000,
  });
}
