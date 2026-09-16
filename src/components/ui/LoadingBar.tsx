/**
 * Shared route loading indicator (VMA-006 / VMA-024).
 *
 * The canonical loading state used by every src/app loading.tsx.
 * One lime accent bar, animated via the single .loading-bar class in
 * globals.css (that file holds the one loadingBar keyframes definition).
 *
 * Animation is on the BAR ONLY: the emoji and the label are static
 * (no animate-pulse), killing the old double-pulse noise (VMA-024).
 * The global reduced-motion rule neutralizes the bar animation for
 * users who prefer reduced motion.
 */
export function LoadingBar({ label = "Loading" }: { label?: string }) {
  return (
    <div
      className="min-h-dvh flex items-center justify-center px-5 pb-[calc(2rem+env(safe-area-inset-bottom))]"
      style={{ backgroundColor: "#0f0f14", color: "#e2e8f0" }}
    >
      <div className="text-center">
        <div className="text-3xl mb-4" aria-hidden="true">
          {"\u26A1"}
        </div>
        <div
          className="text-xs font-bold tracking-[0.15em] uppercase"
          style={{ color: "#94a3b8" }}
        >
          {label}...
        </div>
        <div
          className="mt-4 w-48 h-1 mx-auto rounded-full"
          style={{ backgroundColor: "#1a1a24", border: "1px solid #2a2a3a" }}
        >
          <div
            className="loading-bar h-full rounded-full"
            style={{ backgroundColor: "#a8ff2f", width: "30%" }}
            role="progressbar"
            aria-label={`${label} in progress`}
          />
        </div>
      </div>
    </div>
  );
}
