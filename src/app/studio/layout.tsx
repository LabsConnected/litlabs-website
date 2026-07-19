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
  return children;
}
