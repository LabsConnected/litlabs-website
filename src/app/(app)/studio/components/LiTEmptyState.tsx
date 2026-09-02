"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";
import LiTTPresence from "./LiTTPresence";
import RecentConversations from "./RecentConversations";
import type { AgentId } from "../stores/useStudioAgentStore";
import type {
  FirstMissionActionId,
  FirstMissionFact,
  FirstMissionLaunchpadState,
} from "../lib/first-mission-launchpad";

const FACT_META: Record<
  FirstMissionFact["status"],
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  verified: { label: "Verified", color: "var(--litt-primary)", icon: CheckCircle2 },
  pending: { label: "Checking", color: "#e3b341", icon: CircleDashed },
  unavailable: { label: "Unavailable", color: "#fca5a5", icon: AlertCircle },
  not_started: { label: "Not checked", color: "var(--text-muted)", icon: CircleDashed },
};

export default function LiTEmptyState({
  activeAgentId = "litt",
  displayName,
  launchpadState,
  onPrimaryAction,
  onSelectConversation,
}: {
  activeAgentId?: AgentId;
  displayName?: string | null;
  launchpadState: FirstMissionLaunchpadState;
  onPrimaryAction: (action: FirstMissionActionId) => void;
  onSelectConversation?: (conversationId: string) => void;
}) {
  const greetingName = displayName?.trim();
  const action = launchpadState.primaryAction;

  return (
    <div
      className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-4 py-5 sm:py-8 animate-fadeInUp"
      style={{ color: "var(--text-primary)" }}
      data-testid="empty-state"
      data-launchpad-state={launchpadState.key}
      aria-live="polite"
      aria-label="First mission launchpad"
    >
      <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-5">
        <div className="relative grid min-h-[180px] place-items-center" style={{ overflow: "visible" }}>
          {activeAgentId === "litt" ? (
            <LiTTPresence state="idle" variant="empty-state" size="xl" />
          ) : (
            <div
              className="relative grid h-36 w-36 place-items-center overflow-hidden rounded-full border"
              style={{
                borderColor: "rgba(244,114,182,.45)",
                background: "radial-gradient(circle, rgba(244,114,182,.2), transparent 70%)",
                boxShadow: "0 0 36px rgba(244,114,182,.25)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/spark-agent-portrait.png" alt="Spark" className="h-full w-full object-contain p-1" />
            </div>
          )}
          <span
            className="glass-status-pill absolute -bottom-2"
            style={{
              borderColor: activeAgentId === "spark" ? "rgba(244,114,182,.45)" : "var(--glass-border-green)",
              color: activeAgentId === "spark" ? "var(--spark-primary)" : "var(--glass-green)",
            }}
          >
            {activeAgentId === "spark" ? "Spark · Creative" : "LiTT · Operating"}
          </span>
        </div>

        <div className="max-w-2xl text-center">
          <div
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]"
            style={{
              borderColor: launchpadState.key === "verified"
                ? "rgba(114,242,56,0.28)"
                : "rgba(227,179,65,0.28)",
              backgroundColor: launchpadState.key === "verified"
                ? "rgba(114,242,56,0.06)"
                : "rgba(227,179,65,0.06)",
              color: launchpadState.key === "verified" ? "var(--litt-primary)" : "#e3b341",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            {launchpadState.eyebrow}
          </div>
          <h1
            className="mt-3 text-xl font-black tracking-tight sm:text-2xl lg:text-3xl"
            style={{ color: "var(--text-primary)" }}
          >
            {greetingName ? `${greetingName}, ${launchpadState.title}` : launchpadState.title}
          </h1>
          <p
            className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed sm:text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            {launchpadState.description}
          </p>
        </div>

        <section
          className="glass-panel w-full p-4 sm:p-5"
          aria-label="Verified prerequisites"
          data-testid="first-mission-facts"
        >
          <div className="glass-section-header">Verified prerequisites</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {launchpadState.facts.map((item) => {
              const meta = FACT_META[item.status];
              const Icon = meta.icon;
              return (
                <div
                  key={item.label}
                  className="flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-3"
                  style={{
                    borderColor: "var(--studio-border-strong)",
                    backgroundColor: "rgba(255,255,255,0.02)",
                  }}
                >
                  <Icon size={14} className="mt-0.5 shrink-0" style={{ color: meta.color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>
                        {item.label}
                      </span>
                      <span className="text-[9px] font-black uppercase tracking-[0.12em]" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1 text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>
                      {item.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex w-full max-w-md flex-col items-center gap-2">
          {action ? (
            <button
              type="button"
              onClick={() => onPrimaryAction(action.id)}
              disabled={action.disabled}
              aria-describedby={action.disabledReason ? "first-mission-action-reason" : undefined}
              className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-[12px] font-black transition-all hover:-translate-y-0.5 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                borderColor: "rgba(114,242,56,0.38)",
                backgroundColor: "rgba(114,242,56,0.10)",
                color: "var(--litt-primary)",
                boxShadow: "0 8px 28px rgba(114,242,56,0.08)",
              }}
              data-testid="first-mission-primary-action"
            >
              {action.label}
              <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
            </button>
          ) : (
            <div
              className="w-full rounded-xl border px-4 py-3 text-center text-[11px] font-medium"
              style={{
                borderColor: "rgba(227,179,65,0.22)",
                backgroundColor: "rgba(227,179,65,0.06)",
                color: "#e3b341",
              }}
              role="status"
            >
              {launchpadState.key === "workspace_preparing"
                ? "Checking workspace status. Actions remain unavailable until the workspace reports ready."
                : "No action is available until these checks complete."
              }
            </div>
          )}
          {action?.disabledReason && (
            <p id="first-mission-action-reason" className="text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              {action.disabledReason}
            </p>
          )}
          {launchpadState.key === "verified" && (
            <p className="text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              This prepares the composer only. Nothing runs until you submit it.
            </p>
          )}
        </div>

        {onSelectConversation && (
          <section className="glass-panel w-full p-4" aria-label="Recent conversations">
            <div className="glass-section-header mb-3">Or resume a real conversation</div>
            <RecentConversations onSelect={onSelectConversation} />
          </section>
        )}
      </div>
    </div>
  );
}