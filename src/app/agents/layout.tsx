import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agents",
  description: "Browse and deploy specialized AI agents for coding, content creation, design, and more.",
};

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
