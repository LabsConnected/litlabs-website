import { LoadingBar } from "@/components/ui/LoadingBar";

/**
 * Legacy alias kept for the ~54 route `loading.tsx` files that import it.
 * Renders the canonical <LoadingBar> (lime, single keyframes definition,
 * bar-only animation). See src/components/ui/LoadingBar.tsx.
 */
export function RouteLoading({ label = "Loading" }: { label?: string }) {
  return <LoadingBar label={label} />;
}
