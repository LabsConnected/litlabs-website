"use client";

/**
 * LiTT Base Station — AgentsPageClient
 *
 * Thin entry point: reads the Clerk auth state, redirects to /sign-in if
 * the user isn't signed in, and renders the `BaseStationShell`. All the
 * actual Base Station logic lives in the components/ tree.
 *
 * (Phase 1 left the file in place with the legacy "crew + mission
 * composer" UI; Phase 4 replaces that with a single render of the new
 * shell. The legacy code was archived in git history.)
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import BaseStationShell from "./components/BaseStationShell";
import type { AgentId } from "./store/stationStore";

const VALID_AGENTS: AgentId[] = ["litt", "spark"];
const LEGACY_ALIASES: Record<string, AgentId> = {
  littcode: "litt",
  littlebit: "litt",
};

export default function AgentsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);

  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/agents");
    }
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    const agentParam = searchParams.get("agent");
    if (!agentParam) return;
    const resolved = LEGACY_ALIASES[agentParam] ?? (VALID_AGENTS.includes(agentParam as AgentId) ? (agentParam as AgentId) : null);
    if (resolved) setSelectedAgentId(resolved);
  }, [searchParams]);

  if (!isLoaded || !isSignedIn) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <p className="text-sm opacity-60">Loading Base Station…</p>
      </div>
    );
  }

  return (
    <BaseStationShell
      selectedAgentId={selectedAgentId}
      onSelectAgentAction={(agentId) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("agent", agentId);
        router.replace(`/agents?${params.toString()}`);
      }}
      onOpenAgentChatAction={(agentId) => {
        router.push(`/studio?mode=command&surface=agents&agent=${agentId}`);
      }}
      onAssignMissionAction={(agentId) => {
        router.push(`/studio?mode=command&surface=mission&agent=${agentId}`);
      }}
      onOpenTerminalAction={(agentId) => {
        router.push(`/studio?mode=terminal&agent=${agentId}`);
      }}
    />
  );
}
