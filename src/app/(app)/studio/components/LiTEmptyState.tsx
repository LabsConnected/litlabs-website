"use client";

/**
 * LiTEmptyState — the empty-conversation surface.
 *
 * Larry's directive (2026-11-10): the chat must open straight into
 * the conversation — no welcome interstitial. This surface used to
 * be a full-screen "first mission launchpad" (hero presence,
 * greeting headline, describe-your-business funnel, setup-check
 * theater). That welcome screen is gone. What remains is only what
 * is functional:
 *
 *  - A compact state notice when the launchpad is NOT ready
 *    (blocked / preparing / provider or terminal trouble): the
 *    honest title + description, the real primary action when one
 *    exists (prepare/retry workspace, configure provider, connect
 *    terminal…), and the expandable setup facts behind the status
 *    line. Ready states render NO notice — silence means ready.
 *
 * Board-only cleanup (2026-11-14, Larry): the creation-type chips
 * (Website / Image / Video / Music / Code / Design / Game), the
 * prompt-starter chips and the "Or resume a real conversation" list
 * do NOT carry over — the chat lands straight in the conversation.
 * The content types themselves live on the board (Media covers
 * Image / Video / Music; Code, Preview and Canvas & Design cover the
 * rest), and conversations are managed from the chat panel itself.
 */

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
} from "lucide-react";
import type {
  FirstMissionActionId,
  FirstMissionFact,
  FirstMissionLaunchpadState,
} from "../lib/first-mission-launchpad";

/**
 * The welcome line shown over the composer before the first run
 * (spec §2c, Larry 2026-11-16: the old line — "Describe what you want
 * to build — LiTT drafts it, you review the changes, and nothing
 * publishes without your say" — gets rewritten). This wording is
 * PROPOSED for Larry's final pick; it lives in exactly this one
 * place so changing it is a one-line edit. BoardChatPanel renders it
 * as its first-action line (the line never lived in this component's
 * JSX — the empty state renders no welcome by design).
 */
export const LITT_WELCOME_LINE =
  "Tell LiTT what you want to build. LiTT drafts it, shows you every change, and nothing goes live without your say.";

const FACT_META: Record<
  FirstMissionFact["status"],
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  verified: { label: "Verified", color: "var(--litt-primary)", icon: CheckCircle2 },
  pending: { label: "Checking", color: "#e3b341", icon: CircleDashed },
  unavailable: { label: "Unavailable", color: "#fca5a5", icon: AlertCircle },
  not_started: { label: "Not checked", color: "var(--text-muted)", icon: CircleDashed },
};

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
  launchpadState,
  onPrimaryAction,
}: {
  launchpadState: FirstMissionLaunchpadState;
  onPrimaryAction: (action: FirstMissionActionId) => void;
}) {
  const [showChecks, setShowChecks] = useState(false);
  const action = launchpadState.primaryAction;
  const isReady =
    launchpadState.key === "verified" || launchpadState.key === "inspection_proven";
  const status = statusFor(launchpadState.key);

  return (
    <div
      className="relative flex w-full flex-col px-4 py-4"
      style={{ color: "var(--text-primary)" }}
      data-testid="empty-state"
      data-launchpad-state={launchpadState.key}
      aria-live="polite"
      aria-label="Conversation start"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {!isReady && (
          <section
            className="w-full rounded-xl border px-4 py-3"
            style={{
              borderColor: "var(--studio-border-strong)",
              backgroundColor: "var(--studio-surface)",
            }}
            aria-label="Workspace status"
            data-testid="first-mission-notice"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 max-w-xl">
                <div
                  className="text-sm font-black tracking-tight"
                  style={{ color: "var(--text-primary)" }}
                >
                  {launchpadState.title}
                </div>
                <p
                  className="mt-1 text-[13px] leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {launchpadState.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowChecks((v) => !v)}
                aria-expanded={showChecks}
                data-testid="first-mission-status"
                className="inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition hover:opacity-80"
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
            </div>

            {showChecks && (
              <section
                className="mt-3 w-full"
                aria-label="Setup checks"
                data-testid="first-mission-facts"
              >
                <div className="grid gap-2 sm:grid-cols-2">
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
              <button
                type="button"
                onClick={() => onPrimaryAction(action.id)}
                disabled={action.disabled}
                aria-describedby={action.disabledReason ? "first-mission-action-reason" : undefined}
                className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-black transition-all hover:-translate-y-0.5 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor: "rgba(114,242,56,0.38)",
                  backgroundColor: "rgba(114,242,56,0.10)",
                  color: "var(--litt-primary)",
                }}
                data-testid="first-mission-primary-action"
              >
                {action.label}
                <ArrowRight size={14} aria-hidden />
              </button>
            ) : (
              <div
                className="mt-3 w-full rounded-xl border px-4 py-3 text-[11px] font-medium"
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
              <p id="first-mission-action-reason" className="mt-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
                {action.disabledReason}
              </p>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
