"use client";

/**
 * BoardChatPanel — the LiTT Command Center as a movable board panel
 * (board-only rebuild, 2026-11-14, Larry's mockup).
 *
 * The panel owns the chat chrome only: Chat / Jobs tabs, a New Chat
 * button that lives inside this panel and nowhere else, and the
 * "Site ready!" result card with Preview / Review changes / Undo
 * actions and "Try next" suggestion rows. The transcript and composer
 * themselves are CommandStudio's real conversation pieces, passed in
 * unchanged — landing straight in the conversation, with no
 * create-type chips, no prompt-starter chips and no resume list (the
 * rejected elements do not carry over; the empty state keeps only its
 * honest status notice).
 *
 * Jobs tab (spec Amendments 1 + 3, Larry 2026-11-16): the Files tab is
 * GONE — Files keeps its own standalone board panel and its place
 * inside the Code box. The Jobs tab is the settlement home for the
 * run machinery that used to clutter the conversation: the plan
 * steps, the live task steps, the work log / execution details, the
 * approvals queue and the run's changes. Jobs is fed by REAL state
 * only (mapping §9.3): the execution store, the action-run
 * projection (ActionRunStatusPanel), StudioHealthPanel in approvals
 * mode, and RunChangesPanel. Where a feed has not been wired by the
 * parent yet (projectId / conversationId not passed), the section
 * shows an honest empty state instead of invented data. The Jobs body
 * itself is the shared ChatJobsView (../ChatJobsView) — the Regular
 * layout's LiTTPanel Jobs tab renders the same component, so the two
 * layouts can never drift apart.
 *
 * Single-home doctrine (mapping §9.4): Checks keeps ONE board home.
 * The Checks step inside Jobs is a SUMMARY of the check results the
 * current run recorded in the execution store, plus a summon of the
 * board Checks panel (onOpenChecks) — never a second mounted
 * StudioHealthPanel mode="checks" instance.
 *
 * Styling binds to the ThemeContext skin tokens; violet is the board
 * accent (mockup), green is reserved for status signals. No pink.
 */

import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Eye,
  GitCompareArrows,
  LoaderCircle,
  Plus,
  Undo2,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useExecutionStore } from "../../stores/useExecutionStore";
import { BOARD_ACCENT_VIOLET } from "./board-types";
import { LITT_WELCOME_LINE } from "../LiTEmptyState";
import ChatJobsView from "../ChatJobsView";

const TRY_NEXT_SUGGESTIONS = [
  "Refine the hero copy",
  "Add a pricing section",
  "Adjust the visual style",
] as const;

export interface BoardChatPanelProps {
  projectName: string | null;
  /** The real conversation transcript (CommandStudio's littTranscript). */
  transcript: ReactNode;
  /** The real composer (CommandStudio's littComposer). */
  composer: ReactNode;
  /** The run-state strip (StudioOperatorBar), when a run context exists. */
  operatorBar?: ReactNode;
  onNewChat: () => void;
  onOpenPreview: () => void;
  /**
   * Still accepted for parent compatibility (CommandStudio passes it),
   * but NO Files UI is rendered from it anymore: the Files tab and its
   * pointer content were removed by spec Amendment 1/3 (2026-11-16),
   * and the result card's "View Files" button went with them. Files
   * lives in the board Files panel and inside the Code box.
   */
  onOpenFiles?: () => void;
  /** Real rollback of the last run (restore_checkpoint), when available. */
  onUndo?: () => void;
  /** Open the Changes view for the last run (what changed, with diffs). */
  onReviewChanges?: () => void;
  /**
   * Project in scope, for the Jobs tab's real feeds (approvals queue
   * and run changes). Optional: until the parent wires it, those Jobs
   * sections render honest empty states rather than mounting panels
   * against a null project.
   */
  projectId?: string | null;
  /**
   * Conversation in scope, for the Jobs tab's live task steps
   * (ActionRunStatusPanel) and the run's approval gates. Optional —
   * same honest-empty rule as projectId.
   */
  conversationId?: string | null;
  /** Busy flag forwarded to RunChangesPanel; defaults to the execution store's isRunning. */
  jobsBusy?: boolean;
  /** Refresh key forwarded to RunChangesPanel / approvals (e.g. workspace revision). */
  jobsRefreshKey?: unknown;
  /**
   * Summon the ONE board Checks panel. The Jobs Checks section is a
   * summary + this summon only — it never mounts a second checks
   * instance (single-home doctrine, mapping §9.4).
   */
  onOpenChecks?: () => void;
}

export default function BoardChatPanel({
  projectName,
  transcript,
  composer,
  operatorBar,
  onNewChat,
  onOpenPreview,
  onUndo,
  onReviewChanges,
  projectId = null,
  conversationId = null,
  jobsBusy,
  jobsRefreshKey,
  onOpenChecks,
}: BoardChatPanelProps) {
  const { tokens } = useTheme();
  const [tab, setTab] = useState<"chat" | "jobs">("chat");
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const events = useExecutionStore((s) => s.events);
  const checkpoint = useExecutionStore((s) => s.checkpoint);

  // The plan as a green-check list: the run's own recorded steps (the
  // same execution events the transcript's live progress reads) — real
  // work, checked off as it lands. The Chat tab reads it for the
  // welcome line, the live progress line and the result card; the full
  // list renders in the Jobs tab (ChatJobsView derives its own copy).
  const planSteps = events
    .filter((e) => !e.lowLevel && e.summary?.trim())
    .slice(-6);
  const runFinished = phase === "done" && !isRunning;
  const showResultCard = runFinished && (planSteps.length > 0 || checkpoint !== null);

  const tabButton = (active: boolean) =>
    active
      ? { backgroundColor: BOARD_ACCENT_VIOLET, color: "#FFFFFF" }
      : { color: tokens.textMuted };

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="board-chat-panel"
      style={{ backgroundColor: tokens.surface, color: tokens.text }}
    >
      <div
        data-board-drag-handle
        className="flex shrink-0 cursor-grab touch-none items-center gap-1 border-b px-2 py-1.5 active:cursor-grabbing"
        style={{ borderColor: tokens.border }}
      >
        <div
          className="flex items-center gap-0.5 rounded-full border p-0.5"
          style={{ borderColor: tokens.border }}
          role="tablist"
          aria-label="Chat panel tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chat"}
            data-testid="board-chat-tab-chat"
            className="rounded-full px-3 py-1 text-[11px] font-semibold"
            style={tabButton(tab === "chat")}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "jobs"}
            data-testid="board-chat-tab-jobs"
            className="rounded-full px-3 py-1 text-[11px] font-semibold"
            style={tabButton(tab === "jobs")}
            onClick={() => setTab("jobs")}
          >
            Jobs
          </button>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="board-chat-new-chat"
          className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
          style={{ borderColor: tokens.border, color: tokens.text }}
          onClick={onNewChat}
        >
          <Plus size={12} aria-hidden />
          New Chat
        </button>
      </div>

      {tab === "jobs" ? (
        <ChatJobsView
          projectId={projectId}
          conversationId={conversationId}
          jobsBusy={jobsBusy}
          jobsRefreshKey={jobsRefreshKey}
          onOpenChecks={onOpenChecks}
        />
      ) : (
        <>
          {/* First action, obvious (Studio Finish Spec): before the
              first run, one plain line over the composer says what to
              do. It disappears the moment a run exists. The wording is
              the single LITT_WELCOME_LINE constant in LiTEmptyState —
              Larry's final pick changes it in exactly one place. */}
          {planSteps.length === 0 && !isRunning && (
            <p
              data-testid="board-chat-first-action"
              className="shrink-0 px-3 pb-1 pt-2 text-[11px] font-medium"
              style={{ color: tokens.textMuted }}
            >
              {LITT_WELCOME_LINE}
            </p>
          )}

          <div className="flex min-h-0 flex-1 flex-col">{transcript}</div>

          {/* Useful progress during generation (Finish Spec): the
              current step, named, while the run is live — the plan
              list in the Jobs tab carries the completed steps. */}
          {isRunning && (
            <div
              data-testid="board-chat-progress"
              role="status"
              className="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surfaceElevated }}
            >
              <LoaderCircle
                size={14}
                className="shrink-0 animate-spin motion-reduce:animate-none"
                style={{ color: BOARD_ACCENT_VIOLET }}
                aria-hidden
              />
              <p className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                Building — {planSteps.length > 0 ? planSteps[planSteps.length - 1].summary : "LiTT is working on your request"}
              </p>
            </div>
          )}

          {showResultCard && (
            <div
              className="mx-2 mb-2 shrink-0 rounded-xl border p-3"
              style={{ borderColor: tokens.border, backgroundColor: tokens.surfaceElevated }}
              data-testid="board-chat-result-card"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2
                  size={18}
                  style={{ color: "var(--litt-primary, #2FBF5A)" }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">
                    {projectName ? `${projectName} — Site ready!` : "Site ready!"}
                  </p>
                  <p className="truncate text-[11px]" style={{ color: tokens.textMuted }}>
                    {checkpoint?.label ?? "The latest run finished successfully."}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="board-chat-result-preview"
                  className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold text-white"
                  style={{ backgroundColor: BOARD_ACCENT_VIOLET }}
                  onClick={onOpenPreview}
                >
                  <Eye size={12} aria-hidden />
                  Preview
                </button>
                {onReviewChanges && (
                  <button
                    type="button"
                    data-testid="board-chat-result-review"
                    className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
                    style={{ borderColor: tokens.border, color: tokens.text }}
                    onClick={onReviewChanges}
                  >
                    <GitCompareArrows size={12} aria-hidden />
                    Review changes
                  </button>
                )}
                {onUndo && (
                  <button
                    type="button"
                    data-testid="board-chat-result-undo"
                    className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
                    style={{ borderColor: tokens.border, color: tokens.text }}
                    onClick={onUndo}
                  >
                    <Undo2 size={12} aria-hidden />
                    Undo
                  </button>
                )}
              </div>
              <div className="mt-2.5">
                <p
                  className="mb-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: tokens.textMuted }}
                >
                  Try next
                </p>
                <div className="flex flex-col">
                  {TRY_NEXT_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      data-testid={`board-chat-try-next-${suggestion}`}
                      className="rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-black/5"
                      style={{ color: tokens.text }}
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("studio:ask-litt", { detail: { prompt: suggestion } }),
                        )
                      }
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {operatorBar}
          {composer}
        </>
      )}
    </div>
  );
}
