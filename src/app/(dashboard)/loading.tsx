/**
 * (dashboard) route group loading state
 *
 * Shows a centered volcanic-themed spinner while dashboard-adjacent
 * pages are warming up. Mirrors the cyber / dark command-center look
 * of the active Director milestone. Uses an inline SVG spinner to
 * avoid the lucide-react type resolution dependency.
 */
export default function DashboardGroupLoading() {
  return (
    <div
      className="min-h-[60vh] w-full flex flex-col items-center justify-center gap-3"
      style={{ color: "#f97316" }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={32}
        height={32}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="animate-spin"
        aria-hidden="true"
      >
        <line x1="12" y1="2" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="22" />
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
        <line x1="2" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
      </svg>
      <p
        className="text-[10px] font-mono uppercase tracking-[0.32em]"
        style={{ color: "#f97316", opacity: 0.7 }}
      >
        Spinning up command center…
      </p>
    </div>
  );
}
