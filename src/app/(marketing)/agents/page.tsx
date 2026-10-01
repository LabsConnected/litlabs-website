import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { buildMetadata } from "@/lib/seo";
import { AgentsCatalog } from "./AgentsCatalog";

export const metadata: Metadata = buildMetadata({ title: "Agents", description: "Meet the specialist agents that support LiTT in Studio. Describe your goal, review the result, and approve before publishing.", path: "/agents", index: true });

export default async function AgentsPage() {
  const { userId } = await auth();
  return <AgentsCatalog signedIn={Boolean(userId)} />;
}
