import type { Metadata, Viewport } from "next";
// Path alias "@/components/dashboard/AutonomicLoopBanner" also works;
// the relative form is used to bypass any stale TypeScript Language
// Server cache that hasn't indexed the new file yet.
import AutonomicLoopBanner from "../../components/dashboard/AutonomicLoopBanner";

export const metadata: Metadata = {
  title: "Dashboard · LiTTree Lab Studios",
  description:
    "Mission control for your AI workforce — agents, artifacts, projects, and the Autonomic Loop status.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a14",
  width: "device-width",
  initialScale: 1,
};

/**
 * (dashboard) route group layout
 *
 * This wraps every dashboard-adjacent page (e.g. /dashboard, /agents,
 * /studio, /deployments, /projects) in a shared shell with a sticky
 * Autonomic Loop status banner. The banner verifies the Director →
 * Agent-Tasks → Worker pipeline is reachable, satisfying the
 * "Autonomic Loop setup" verification step in the active Director task.
 *
 * The route group `(dashboard)` does NOT add a URL segment — pages
 * inside keep their original paths.
 */
export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex flex-col">
      <AutonomicLoopBanner />
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
