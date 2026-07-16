import type { Metadata } from "next";
import AutonomicLoopBanner from "@/components/dashboard/AutonomicLoopBanner";

export const metadata: Metadata = {
  title: "Studio",
  description:
    "AI-powered creative studio. Generate images, videos, music, and code with specialized AI agents.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "LiTTree-LabStudios Studio",
    description:
      "AI-powered creative studio. Generate images, videos, music, and code with specialized AI agents.",
    type: "website",
  },
};

export default function StudioLayout({
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
