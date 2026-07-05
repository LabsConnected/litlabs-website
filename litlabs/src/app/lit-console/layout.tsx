import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LiT Console | LiTTree OS",
  description:
    "LiT Console is the LiTTree OS command center for chat, terminal workflows, agents, and project context.",
};

export default function LitConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
