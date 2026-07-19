import type { Metadata } from "next";
import AutonomicLoopBanner from "@/components/dashboard/AutonomicLoopBanner";

export const metadata: Metadata = {
  title: "Agent",
  description: "Autonomous agent interface for LiTTree LabStudios.",
};

export default function AgentLayout({
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
