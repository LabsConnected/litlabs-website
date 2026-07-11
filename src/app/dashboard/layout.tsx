import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your LiTT Code command center. Manage agents, track stats, and monitor your AI workforce.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
