"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useStudioAgentStore, STUDIO_AGENTS, type AgentId } from "../stores/useStudioAgentStore";
import { useUserPlan } from "../hooks/useUserPlan";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Loader2, Lock, ArrowRight } from "lucide-react";

interface InstalledAgent {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  installedAt: string;
}

interface MyAITeamProps {
  onOpenAgent?: (agentId: AgentId) => void;
}

export function MyAITeam({ onOpenAgent }: MyAITeamProps) {
  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const setActiveAgent = useStudioAgentStore((s) => s.setActiveAgent);
  const { isSignedIn } = useClerkAuth();
  const { plan, loading: planLoading } = useUserPlan();
  const [installed, setInstalled] = useState<InstalledAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const hasAccess = useCallback(
    (minimumPlan: string) => {
      if (planLoading) return true;
      const ranks: Record<string, number> = {
        starter: 0,
        creator_beta: 1,
        founder: 1,
        pro_builder_beta: 2,
      };
      return (ranks[plan ?? "starter"] ?? 0) >= (ranks[minimumPlan] ?? 0);
    },
    [plan, planLoading],
  );

  useEffect(() => {
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    fetch("/api/user-agents")
      .then((r) => r.json().catch(() => ({ agents: [] })))
      .then((data) => {
        const agents = (data.agents || []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          slug: (a.agent as Record<string, unknown>)?.slug ?? a.slug ?? "",
          name: (a.agent as Record<string, unknown>)?.display_name ?? a.name ?? "",
          isActive: a.is_active as boolean,
          installedAt: a.created_at ?? a.installed_at ?? "",
        }));
        setInstalled(agents);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isSignedIn]);

  const handleOpen = useCallback(
    (agentId: AgentId) => {
      setActiveAgent(agentId);
      onOpenAgent?.(agentId);
    },
    [setActiveAgent, onOpenAgent],
  );

  const installedSlugs = new Set(installed.map((a) => a.slug));

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h2 className="text-sm font-black">My AI Team</h2>
        <Link
          href="/marketplace"
          className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/60 transition hover:bg-white/10 hover:text-white/80"
        >
          + Hire Agent
        </Link>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-white/30">
            <Loader2 size={16} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-1.5">
            {STUDIO_AGENTS.map((meta) => {
              const accent = meta.color;
              const isActive = activeAgentId === meta.id;
              const unlocked = !isSignedIn || hasAccess(meta.minimumPlan);
              const isInstalled = installedSlugs.has(meta.id);
              const installedAgent = installed.find((a) => a.slug === meta.id);
              const isPaused = installedAgent && !installedAgent.isActive;

              return (
                <div
                  key={meta.id}
                  className="group rounded-xl border transition"
                  style={{
                    borderColor: isActive ? `${accent}30` : "rgba(255,255,255,0.05)",
                    backgroundColor: isActive ? `${accent}08` : "transparent",
                  }}
                >
                  <button
                    type="button"
                    disabled={!unlocked}
                    onClick={() => unlocked && handleOpen(meta.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {/* Avatar */}
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-black"
                      style={{ backgroundColor: `${accent}15`, color: accent }}
                    >
                      {unlocked ? meta.displayName[0] : <Lock size={12} />}
                    </span>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-bold text-white/90">
                          {meta.displayName}
                        </span>
                        {isActive && (
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: accent }}
                          />
                        )}
                        {isPaused && (
                          <span className="rounded bg-amber-400/10 px-1 text-[8px] font-bold text-amber-300">
                            PAUSED
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[10px] text-white/40">
                        {unlocked ? meta.role : `Requires ${planLabel(meta.minimumPlan)}`}
                      </div>
                    </div>

                    {/* Status indicator */}
                    {unlocked && !isActive && (
                      <ArrowRight
                        size={12}
                        className="opacity-0 transition group-hover:opacity-40"
                        style={{ color: accent }}
                      />
                    )}
                  </button>

                  {/* Locked upgrade link */}
                  {!unlocked && (
                    <Link
                      href={`/pricing?upgrade=${meta.minimumPlan}`}
                      className="flex items-center gap-1 px-3 pb-2 pl-[3.25rem] text-[10px] font-bold transition hover:opacity-80"
                      style={{ color: accent }}
                    >
                      Upgrade to {planLabel(meta.minimumPlan)} →
                    </Link>
                  )}

                  {/* Installed marketplace agent controls */}
                  {unlocked && isInstalled && !isActive && (
                    <div className="flex items-center gap-1 border-t border-white/5 px-3 py-1.5">
                      <span className="text-[9px] text-white/30">Installed</span>
                      <Link
                        href={`/marketplace/agents/${meta.id}`}
                        className="ml-auto rounded px-1.5 py-0.5 text-[9px] font-bold text-white/40 transition hover:text-white/60"
                      >
                        Settings
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Create your own agent CTA */}
            <div className="mt-4 rounded-xl border border-dashed border-white/10 p-3 text-center">
              <p className="text-[10px] text-white/30">
                Want a custom agent?{" "}
                <Link
                  href="/marketplace"
                  className="font-bold text-white/50 transition hover:text-white/80"
                >
                  Browse the marketplace →
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function planLabel(plan: string): string {
  switch (plan) {
    case "creator_beta": return "Creator Beta";
    case "pro_builder_beta": return "Pro Builder Beta";
    case "founder": return "Founding Member";
    default: return plan;
  }
}
