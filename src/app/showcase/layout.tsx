import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Showcase",
  description:
    "See what creators are building with LiTTree Lab Studios — featured projects, agents, and creative works.",
};

export default function ShowcaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
