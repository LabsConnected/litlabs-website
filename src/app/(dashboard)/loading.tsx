import { Loader2 } from "lucide-react";

/**
 * (dashboard) route group loading state
 *
 * Shows a centered volcanic-themed spinner while dashboard-adjacent
 * pages are warming up. Mirrors the cyber / dark command-center look
 * of the active Director milestone.
 */
export default function DashboardGroupLoading() {
  return (
    <div
      className="min-h-[60vh] w-full flex flex-col items-center justify-center gap-3"
      style={{ color: "#f97316" }}
    >
      <Loader2 className="animate-spin" size={32} />
      <p
        className="text-[10px] font-mono uppercase tracking-[0.32em]"
        style={{ color: "#f97316", opacity: 0.7 }}
      >
        Spinning up command center…
      </p>
    </div>
  );
}
