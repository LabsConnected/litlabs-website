import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studio",
  description: "AI-powered creative studio. Generate images, videos, music, and code with specialized AI agents.",
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Studio must not mount the full AutonomicLoopBanner.
  // Per Autonomic Worker Reliability pass: only a compact worker indicator (if present)
  // belongs inside the existing Builder header (StudioCommandDeck), not as a layout banner.
  return children;
}
