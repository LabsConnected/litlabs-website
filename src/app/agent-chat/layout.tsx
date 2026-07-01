import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agent Chat",
  description: "Chat with your AI agents in real time.",
};

export default function AgentChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
