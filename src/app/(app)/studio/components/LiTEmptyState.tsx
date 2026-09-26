"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Globe,
  Loader2,
  Palette,
  Plus,
  Wand2,
  Wrench,
} from "lucide-react";
import LiTTPresence from "./LiTTPresence";
import RecentConversations from "./RecentConversations";
import { DescribeBusinessBox } from "@/components/studio/DescribeBusinessBox";
import type { BusinessProfile } from "@/lib/business-profile";
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

/**
 * Starter intents for the first screen. Tapping one primes the composer via
 * the canonical `studio:ask-litt` event (the same pattern StudioPreviewPanel
 * and the canvas toolbar use): the prompt lands in the chat box and nothing
 * runs until the user sends it.
 */
const STARTER_CHIPS: { label: string; prompt: string; icon: typeof Globe }[] = [
  { label: "Build my business website", prompt: "Build a website for my business", icon: Globe },
  { label: "Fix something broken", prompt: "Something on my site is broken — help me find and fix it", icon: Wrench },
  { label: "Make my site look better", prompt: "Make my site look better", icon: Palette },
  { label: "Create something new", prompt: "I want to create something new", icon: Plus },
  { label: "Surprise me", prompt: "Surprise me — build something cool", icon: Wand2 },
];

function primeComposer(prompt: string) {
  window.dispatchEvent(
    new CustomEvent("studio:ask-litt", { detail: { prompt } }),
  );
}

function statusFor(key: FirstMissionLaunchpadState["key"]): {
  tone: "busy" | "ready" | "attention";
  text: string;
} {
  if (key === "checking" || key === "workspace_preparing" || key === "inspection_running") {
    return { tone: "busy", text: "Getting things ready…" };
  }
  if (key === "verified" || key === "inspection_proven") {
    return { tone: "ready", text: "You're all set" };
  }
  return { tone: "attention", text: "Needs attention" };
}

export default function LiTEmptyState({
  displayName,
  launchpadState,
  onPrimaryAction,
  onSelectConversation,
}: {
  displayName?: string | null;
  launchpadState: FirstMissionLaunchpadState;
  onPrimaryAction: (action: FirstMissionActionId) => void;
  onSelectConversation?: (conversationId: string) => void;
}) {
  const [showChecks, setShowChecks] = useState(false);
  const greetingName = displayName?.trim();
  const action = launchpadState.primaryAction;
  const isBlocked = launchpadState.key === "blocked";
  const status = statusFor(launchpadState.key);
  const headline = isBlocked
    ? launchpadState.title
    : greetingName
      ? `${greetingName}, what do you want LiTT to do?`
      : "What do you want LiTT to do?";

  const handleBusinessConfirmed = ({ profile }: { profile: BusinessProfile }) => {
    const desc = profile.description?.trim();
    primeComposer(desc ? `Build a website for my business: ${desc}` : "Build a website for my business");
  };

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
        <div className="relative grid min-h-[140px] place-items-center" style={{ overflow: "visible" }}>
          <LiTTPresence state="idle" variant="empty-state" size="xl" />
          <span
            className="glass-status-pill absolute -bottom-2"
            style={{
              borderColor: "var(--glass-border-green)",
              color: "var(--glass-green)",
            }}
          >
            LiTT · Operating
          </span>
        </div>

        <div className="max-w-2xl text-center">
          <h1
            className="text-xl font-black tracking-tight sm:text-2xl lg:text-3xl"
            style={{ color: "var(--text-primary)" }}
          >
            {headline}
          </h1>
          <p
            className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed sm:text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            {launchpadState.description}
          </p>
        </div>

        {!isBlocked && (
          <>
            <div
              className="flex w-full max-w-xl flex-wrap items-center justify-center gap-2"
              role="group"
              aria-label="Starter ideas"
              data-testid="first-mission-starter-chips"
            >
              {STARTER_CHIPS.map((chip) => {
                const Icon = chip.icon;
                return (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => primeComposer(chip.prompt)}
                    className="flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] font-bold transition-all hover:-translate-y-0.5 active:scale-[0.99]"
                    style={{
                      borderColor: "var(--studio-border-strong)",
                      backgroundColor: "rgba(255,255,255,0.03)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <Icon size={13} style={{ color: "var(--litt-primary)" }} aria-hidden />
                    {chip.label}
                  </button>
                );
              })}
            </div>

            <div className="w-full max-w-xl" data-testid="first-mission-describe-box">
              <DescribeBusinessBox
                variant="studio"
                projectId={launchpadState.projectId}
                onConfirmed={handleBusinessConfirmed}
              />
            </div>
          </>
        )}

        <div className="flex w-full max-w-md flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setShowChecks((v) => !v)}
            aria-expanded={showChecks}
            data-testid="first-mission-status"
            className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition hover:opacity-80"
            style={{
              borderColor:
                status.tone === "ready"
                  ? "rgba(114,242,56,0.28)"
                  : status.tone === "busy"
                    ? "rgba(227,179,65,0.28)"
                    : "rgba(252,165,165,0.28)",
              backgroundColor:
                status.tone === "ready"
                  ? "rgba(114,242,56,0.06)"
                  : status.tone === "busy"
                    ? "rgba(227,179,65,0.06)"
                    : "rgba(252,165,165,0.06)",
              color:
                status.tone === "ready"
                  ? "var(--litt-primary)"
                  : status.tone === "busy"
                    ? "#e3b341"
                    : "#fca5a5",
            }}
          >
            {status.tone === "busy" ? (
              <Loader2 size={11} className="animate-spin" aria-hidden />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            )}
            {status.text}
            <ChevronDown
              size={11}
              aria-hidden
              className={`transition-transform ${showChecks ? "rotate-180" : ""}`}
            />
          </button>

          {showChecks && (
            <section
              className="glass-panel w-full p-4 sm:p-5"
              aria-label="Setup checks"
              data-testid="first-mission-facts"
            >
              <div className="glass-section-header">Setup checks</div>
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
          )}

          {action ? (
            launchpadState.key === "verified" ? (
              <button
                type="button"
                onClick={() => onPrimaryAction(action.id)}
                disabled={action.disabled}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[11px] font-bold transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor: "var(--studio-border-strong)",
                  color: "var(--text-secondary)",
                }}
                data-testid="first-mission-primary-action"
              >
                {action.label}
                <ArrowRight size={12} aria-hidden />
              </button>
            ) : (
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
            )
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
                ? "LiTT is still getting set up — everything unlocks when it's done."
                : "Nothing is available until the checks finish."}
            </div>
          )}
          {action?.disabledReason && (
            <p id="first-mission-action-reason" className="text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              {action.disabledReason}
            </p>
          )}
          {!isBlocked && (
            <p className="text-center text-[10px]" style={{ color: "var(--text-muted)" }}>
              Choosing one fills in the chat box — nothing runs until you send it.
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
