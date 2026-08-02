import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Studio",
  description:
    "LiTTree Lab Studios — your AI-powered creative workspace for building, chatting, and collaborating with AI agents.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
