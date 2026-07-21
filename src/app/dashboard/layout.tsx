import type { Metadata } from "next";
import AutonomicLoopBanner from "@/components/dashboard/AutonomicLoopBanner";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Your LiTTree LabStudios command center. Manage agents, track stats, and monitor your AI workforce.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AutonomicLoopBanner />
      {children}
    </>
  );
}
