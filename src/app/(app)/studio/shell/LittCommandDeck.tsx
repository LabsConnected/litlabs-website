"use client";

/**
 * Studio shell LiTT command deck — docked at the bottom of the center column,
 * NEVER a floating overlay.
 *
 * Slim strip when collapsed (ticker + selection chip + expand). Expanded:
 * Chat/Live tabs over the real transcript, with the real CommandComposer
 * below. Everything here sends through the canonical conversation controller —
 * the deck is a relocation of the chat pieces, not a rewrite.
 */

import { useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import CommandComposer from "../components/CommandComposer";
import LiTTLiveActivity from "../components/LiTTLiveActivity";
import { useExecutionStore } from "../stores/useExecutionStore";
import type { StudioSelectionPayload } from "../context/StudioContext";
import type { SendResult } from "../hooks/useCanonicalConversation";
import { useStudioShell } from "./StudioShellContext";
import { DeckTranscript } from "./DeckTranscript";

const PHASE_LABELS: Record<string, string> = {
  idle: "Idle",
  planning: "Planning",
  inspecting: "Inspecting",
  editing: "Editing",
  testing: "Testing",
  verifying: "Verifying",
  done: "Complete",
  failed: "Needs verification",
  cancelled: "Cancelled",
  awaiting_approval: "Approval needed",
  awaiting_input: "Awaiting input",
};

function SelectionChip() {
  const { selection, clearSelection } = useStudioShell();
  if (!selection) return null;
  return (
    <span
      className="flex max-w-[240px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
      style={{ borderColor: "rgba(163,230,53,0.35)", color: "var(--litt-primary)" }}
      data-testid="studio-deck-selection-chip"
    >
      <span className="truncate">{selection.label}</span>
      <button
        type="button"
        onClick={clearSelection}
        className="rounded-full p-0.5 transition hover:opacity-70"
        aria-label="Clear selection"
      >
        <X size={12} />
      </button>
    </span>
  );
}

export function LittCommandDeck() {
  const {
    deckCollapsed,
    setDeckCollapsed,
    deckExpanded,
    setDeckExpanded,
    deckTab,
    setDeckTab,
    conversation,
    composerValue,
    setComposerValue,
    sendMessage,
    selection,
    clearSelection,
    capabilities,
    activeTaskId,
  } = useStudioShell();

  const phase = useExecutionStore((s) => s.phase);
  const lastEvent = useExecutionStore((s) => s.events[s.events.length - 1]);

  const handleSend = useCallback(
    (value: string, attachments?: string[]) =>
      sendMessage(value, attachments) as Promise<SendResult | undefined>,
    [sendMessage],
  );

  const composerSelection = useMemo<StudioSelectionPayload | null>(() => {
    if (!selection || selection.kind !== "element") return null;
    return {
      kind: "preview-element",
      label: selection.label,
      selector: selection.ref,
      tagName: selection.tagName,
      projectId: capabilities.projectId ?? "",
      worktabId: activeTaskId ?? undefined,
      conversationId: conversation.selectedConversationId,
      timestamp: Date.now(),
    };
  }, [selection, capabilities.projectId, activeTaskId, conversation.selectedConversationId]);

  const ticker =
    phase !== "idle"
      ? `${PHASE_LABELS[phase] ?? phase}${lastEvent?.summary ? ` — ${lastEvent.summary}` : ""}`
      : null;

  if (deckCollapsed) {
    return (
      <div
        className="flex h-11 shrink-0 items-center gap-2 border-t px-3"
        style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
        data-testid="studio-deck-collapsed"
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-black"
          style={{ backgroundColor: "var(--litt-primary)", color: "#0b0f04" }}
        >
          L
        </span>
        <span className="min-w-0 flex-1 truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {ticker ?? (selection ? `Selected: ${selection.label}` : "Ask LiTT anything…")}
        </span>
        <SelectionChip />
        <button
          type="button"
          onClick={() => setDeckCollapsed(false)}
          className="rounded-lg p-1.5 transition hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          aria-label="Expand LiTT deck"
        >
          <ChevronUp size={16} />
        </button>
      </div>
    );
  }

  return (
    <section
      className="flex shrink-0 flex-col border-t"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      aria-label="LiTT command deck"
      data-testid="studio-command-deck"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-black"
          style={{ backgroundColor: "var(--litt-primary)", color: "#0b0f04" }}
        >
          L
        </span>
        <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
          LiTT
        </span>
        <div className="ml-2 flex items-center gap-1" role="tablist" aria-label="Deck view">
          {(["chat", "live"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={deckTab === tab}
              onClick={() => {
                setDeckTab(tab);
                if (!deckExpanded) setDeckExpanded(true);
              }}
              className="rounded-lg px-2.5 py-1 text-[11px] font-bold capitalize transition"
              style={
                deckTab === tab
                  ? { backgroundColor: "rgba(163,230,53,0.12)", color: "var(--litt-primary)" }
                  : { color: "var(--text-muted)" }
              }
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <SelectionChip />
        <button
          type="button"
          onClick={() => setDeckExpanded((v) => !v)}
          className="rounded-lg p-1.5 transition hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          aria-label={deckExpanded ? "Collapse transcript" : "Expand transcript"}
          aria-expanded={deckExpanded}
        >
          {deckExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        <button
          type="button"
          onClick={() => setDeckCollapsed(true)}
          className="rounded-lg p-1.5 transition hover:opacity-70"
          style={{ color: "var(--text-muted)" }}
          aria-label="Collapse LiTT deck"
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {deckExpanded && (
        <div className="h-64 min-h-0 shrink-0 overflow-hidden border-t" style={{ borderColor: "var(--studio-border)" }}>
          {deckTab === "chat" ? <DeckTranscript /> : <LiTTLiveActivity />}
        </div>
      )}

      <div className="shrink-0 px-3 pb-3 pt-1">
        <CommandComposer
          value={composerValue}
          onChange={setComposerValue}
          onSend={handleSend}
          onCancel={conversation.cancel}
          busy={conversation.busy}
          disabled={conversation.requiresReauth}
          selection={composerSelection}
          onClearSelectionItem={clearSelection}
          compact
        />
      </div>
    </section>
  );
}
