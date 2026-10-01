import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { buildMetadata } from "@/lib/seo";
import { AgentsCatalog } from "./AgentsCatalog";

export const metadata: Metadata = buildMetadata({ title: "Agents", description: "Meet the specialist agents that support LiTT in Studio. Describe your goal, review the result, and approve before publishing.", path: "/agents", index: true });

export default async function AgentsPage() {
  let userId: string | null = null;
  try {
    const session = await auth();
    userId = session.userId;
  } catch {
    // Clerk middleware unavailable (e.g. test env) — treat as signed out
  }
  return <AgentsCatalog signedIn={Boolean(userId)} />;
}
