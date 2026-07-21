"use client";

/**
 * LiTT Base Station — BaseStationShell (Phase 5: 2.5D + intro hero)
 *
 * Orchestrates the full Base Station. Phase 5 adds:
 *   - a polished hero header that names the station, surfaces the user
 *     greeting, and shows a tiny "all systems online" indicator
 *   - a 2.5D viewport experience driven by the upgraded StationViewport
 *   - a per-mode hint that explains what each mode is good for
 *
 * Desktop layout: 3-column grid (roster + customizer left, canvas center,
 * mission dock + inspector right). Mobile: stacked layout via
 * MobileAgentHome.
 */

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import StationSettings from "./StationSettings";
import AgentRoster from "./AgentRoster";
import SparkCustomizer from "./SparkCustomizer";
import StationViewport from "./StationViewport";
import AgentInspector from "./AgentInspector";
import MissionDock from "./MissionDock";
import MobileAgentHome from "./MobileAgentHome";
import { useStationStore, type AgentId } from "../store/stationStore";
import { useStationLayout } from "../hooks/useStationLayout";

const MODE_HINTS: Record<string, string> = {
  explore: "Pan with the pointer. Click an agent to inspect.",
  edit: "Drag agents to reposition. Saved automatically.",
  command: "Queue a mission below. It runs in the background.",
};

export default function BaseStationShell() {
  const { resolvedColors: T } = useTheme();
  const { saving } = useStationLayout();
  const layout = useStationStore();
  const { profile } = useProfile();
  const { isSignedIn } = useClerkAuth();
  const [selectedAgent, setSelectedAgent] = useState<AgentId | null>(null);

  const userName = profile?.displayName?.split(" ")[0] || profile?.username || "creator";

  return (
    <main
      className="relative h-full min-h-0 overflow-y-auto"
      style={{ backgroundColor: "transparent", color: T.textColor }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 15% 15%, ${T.accentColor}10, transparent 32%), radial-gradient(circle at 85% 40%, ${T.linkColor}0b, transparent 30%)`,
        }}
      />
      <div className="relative mx-auto max-w-7xl space-y-3 px-3 py-3 sm:space-y-4 sm:px-4 sm:py-4">

        {/* Hero header — appears on desktop, hidden on mobile (the mobile
            layout has its own stack of cards that double as their own
            headers). */}
        <header
          className="relative hidden min-h-32 overflow-hidden rounded-3xl border lg:block"
          style={{
            borderColor: `${T.accentColor}30`,
            backgroundColor: "#050805",
          }}
        >
          {/* Background hero image — the existing mascot character sheet. */}
          <div
            className="absolute inset-0 bg-cover"
            style={{
              backgroundImage: "url('/brand/litt-mascot-character-sheet.png')",
              backgroundPosition: "58% 24%",
              opacity: 0.45,
            }}
            aria-hidden
          />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(90deg,rgba(3,7,5,.98) 0%,rgba(3,7,5,.88) 38%,rgba(3,7,5,.2) 72%,rgba(3,7,5,.55) 100%)",
            }}
            aria-hidden
          />
          <div className="relative z-10 flex max-w-xl items-center gap-3 p-5 sm:p-6">
            <div
              className="grid h-12 w-12 place-items-center rounded-2xl"
              style={{
                background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`,
                boxShadow: `0 0 28px ${T.accentColor}40`,
              }}
            >
              <span className="text-[11px] font-black text-white">LiTT</span>
            </div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[.22em] text-lime-300">
                LiTT Base Station
              </p>
              <h1 className="text-2xl font-black text-white sm:text-3xl">
                Welcome back, {userName}.
              </h1>
              <p className="mt-1 max-w-md text-xs leading-5 text-white/70">
                {isSignedIn
                  ? "Your crew is online. Drag to position, click to inspect, queue a mission when you're ready."
                  : "Sign in to queue missions, save layouts, and chat with your crew."}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1.5 self-start rounded-full border bg-emerald-500/15 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-200" style={{ borderColor: "rgba(52,211,153,.4)" }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
              All systems
            </div>
          </div>
        </header>

        {/* Desktop layout */}
        <div className="hidden lg:flex lg:h-[calc(100dvh-12rem)] lg:flex-col lg:gap-3">
          <StationSettings saving={saving} />
          <p
            className="text-center text-[10px] font-bold italic"
            style={{ color: T.textMuted }}
          >
            {MODE_HINTS[layout.mode] ?? ""}
          </p>
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[16rem_minmax(0,1fr)_18rem]">
            {/* Left rail */}
            <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
              <AgentRoster />
              <SparkCustomizer />
            </aside>

            {/* Center canvas */}
            <section className="min-h-0">
              <StationViewport
                mode={layout.mode}
                selectedAgent={selectedAgent}
                onSelectAgent={setSelectedAgent}
              />
            </section>

            {/* Right rail */}
            <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
              {selectedAgent ? (
                <AgentInspector
                  agentId={selectedAgent}
                  onClose={() => setSelectedAgent(null)}
                />
              ) : (
                <section
                  className="rounded-2xl border p-4"
                  style={{
                    borderColor: `${T.borderColor}25`,
                    backgroundColor: `${T.boxBg}99`,
                  }}
                >
                  <h3 className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.textMuted }}>
                    Inspector
                  </h3>
                  <p className="mt-2 text-xs" style={{ color: T.textMuted }}>
                    Click an agent on the canvas to inspect its role, personality, and domains.
                  </p>
                </section>
              )}
              <MissionDock />
            </aside>
          </div>
        </div>

        {/* Mobile layout */}
        <MobileAgentHome saving={saving} />
      </div>
    </main>
  );
}
