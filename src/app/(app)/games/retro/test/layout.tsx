import type { Metadata } from "next";

// ROM-upload diagnostics page — never indexable, even if the arcade
// itself is later opened to indexing.
export const metadata: Metadata = {
  title: "Diagnostics — LiTT Retro Arcade",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RetroTestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
