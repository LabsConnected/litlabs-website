"use client";

/**
 * BoardChatPanel — the LiTT Command Center as a movable board panel
 * (board-only rebuild, 2026-11-14, Larry's mockup).
 *
 * The panel owns the chat chrome only: Chat / Files tabs (Activity is
 * NOT a chat tab — it is its own board panel), a New Chat button that
 * lives inside this panel and nowhere else, the run's plan as a
 * green-check list, and the "Site ready!" result card with Preview /
 * View Files actions and "Try next" suggestion rows. The transcript
 * and composer themselves are CommandStudio's real conversation pieces,
 * passed in unchanged — landing straight in the conversation, with no
 * create-type chips, no prompt-starter chips and no resume list (the
 * rejected elements do not carry over; the empty state keeps only its
 * honest status notice).
 *
 * The Files tab does not mount a second file tree: project files have
 * exactly one home on the board — the Files panel (single-instance
 * rule, PR #976) — so the tab points there honestly.
 *
 * Styling binds to the ThemeContext skin tokens; violet is the board
 * accent (mockup), green is reserved for status signals. No pink.
 */

import { useState, type ReactNode } from "react";
import { CheckCircle2, Eye, FolderOpen, LoaderCircle, Plus } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useExecutionStore } from "../../stores/useExecutionStore";
import { BOARD_ACCENT_VIOLET } from "./board-types";

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
  onOpenFiles: () => void;
}

export default function BoardChatPanel({
  projectName,
  transcript,
  composer,
  operatorBar,
  onNewChat,
  onOpenPreview,
  onOpenFiles,
}: BoardChatPanelProps) {
  const { tokens } = useTheme();
  const [tab, setTab] = useState<"chat" | "files">("chat");
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const events = useExecutionStore((s) => s.events);
  const checkpoint = useExecutionStore((s) => s.checkpoint);

  // The plan as a green-check list: the run's own recorded steps (the
  // same execution events the transcript's live progress reads) — real
  // work, checked off as it lands.
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
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
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
            aria-selected={tab === "files"}
            data-testid="board-chat-tab-files"
            className="rounded-full px-3 py-1 text-[11px] font-semibold"
            style={tabButton(tab === "files")}
            onClick={() => setTab("files")}
          >
            Files
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

      {tab === "files" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <FolderOpen size={22} style={{ color: tokens.textMuted }} aria-hidden />
          <p className="text-xs leading-5" style={{ color: tokens.textMuted }}>
            Project files live in the Files panel — one home for files on
            the board, always in sync with this conversation.
          </p>
          <button
            type="button"
            data-testid="board-chat-open-files"
            className="rounded-full px-3.5 py-1.5 text-[11px] font-semibold text-white"
            style={{ backgroundColor: BOARD_ACCENT_VIOLET }}
            onClick={onOpenFiles}
          >
            Open Files panel
          </button>
        </div>
      ) : (
        <>
          {planSteps.length > 0 && (
            <div
              className="shrink-0 border-b px-3 py-2"
              style={{ borderColor: tokens.border }}
              data-testid="board-chat-plan"
            >
              <p
                className="mb-1 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: tokens.textMuted }}
              >
                Plan
              </p>
              <ul className="flex flex-col gap-1">
                {planSteps.map((step, index) => {
                  const isLast = index === planSteps.length - 1;
                  const pending = isRunning && isLast;
                  return (
                    <li
                      key={step.id}
                      className="flex items-start gap-1.5 text-[11px] leading-4"
                      style={{ color: tokens.text }}
                    >
                      {pending ? (
                        <LoaderCircle
                          size={13}
                          className="mt-0.5 shrink-0 animate-spin"
                          style={{ color: tokens.textMuted }}
                          aria-hidden
                        />
                      ) : (
                        <CheckCircle2
                          size={13}
                          className="mt-0.5 shrink-0"
                          style={{ color: "var(--litt-primary, #2FBF5A)" }}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1">{step.summary}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">{transcript}</div>

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
                <button
                  type="button"
                  data-testid="board-chat-result-files"
                  className="flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
                  style={{ borderColor: tokens.border, color: tokens.text }}
                  onClick={onOpenFiles}
                >
                  <FolderOpen size={12} aria-hidden />
                  View Files
                </button>
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
