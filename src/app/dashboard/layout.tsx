import type { Metadata } from "next";
import AutonomicLoopBanner from "@/components/dashboard/AutonomicLoopBanner";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your LiTTree-LabStudios command center. Manage agents, track stats, and monitor your AI workforce.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "LiTTree-LabStudios Dashboard",
    description:
      "Your LiTTree-LabStudios command center. Manage agents, track stats, and monitor your AI workforce.",
    type: "website",
  },
};

/**
 * DashboardLayout
 *
 * Mounts the AutonomicLoopBanner above the dashboard surface so the
 * Director → Agent-Tasks → Worker pipeline is always being verified.
 * This is the canonical place where the "volcanic cyber" surface of
 * the dashboard is glued together — the theme tokens themselves come
 * from `ThemeContext` (default skin = `volcanic`, accent = `sunset-orange`).
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AutonomicLoopBanner />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
