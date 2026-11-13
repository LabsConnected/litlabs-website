"use client";

/**
 * ProjectDecisionPrompt — the stop-and-ask card for the project guard.
 *
 * Rendered when the messages route stops a send with 409
 * PROJECT_MISMATCH / PROJECT_CONTEXT_CONFIRM: the chat would have run
 * against — or been silently rebound to — a project the user has not
 * confirmed. Larry's ruling (2026-11-12): on a project mismatch Studio
 * stops and asks FIRST, names both projects, and moves only on the
 * user's explicit yes. This card is that ask. It has no dismiss chrome:
 * the only ways out are the choice buttons (Stay cancels the send —
 * nothing runs, nothing is rebound).
 */

import type { ProjectDecisionPrompt as ProjectDecisionPromptState } from "../hooks/useCanonicalConversation";

export default function ProjectDecisionPrompt({
  prompt,
  onConfirm,
  onDismiss,
}: {
  prompt: ProjectDecisionPromptState;
  onConfirm: (decision: "switch" | "rebind") => void;
  onDismiss: () => void;
}) {
  const conversationName = prompt.conversationProject?.name ?? "the chat's project";
  const viewedName = prompt.viewedProject?.name ?? "the project you're viewing";
  const targetName = prompt.targetProject?.name ?? viewedName;
  const isMismatch = prompt.code === "PROJECT_MISMATCH";

  const buttonClass =
    "whitespace-nowrap rounded border px-2.5 py-1.5 text-[11px] font-bold";
  const primaryStyle = {
    borderColor: "rgba(245,158,11,0.55)",
    backgroundColor: "rgba(245,158,11,0.18)",
    color: "#fde68a",
  } as const;
  const quietStyle = {
    borderColor: "rgba(245,158,11,0.3)",
    color: "#fcd34d",
  } as const;

  return (
    <div
      role="alertdialog"
      aria-label="Project confirmation needed"
      className="flex min-w-0 shrink-0 flex-col gap-2 border-b px-3 py-2.5 text-[12px]"
      style={{
        borderColor: "rgba(245,158,11,0.35)",
        backgroundColor: "rgba(245,158,11,0.08)",
        color: "#fde68a",
      }}
    >
      <span className="min-w-0 font-medium">
        <strong className="font-bold">
          {isMismatch ? "Wrong project — nothing was sent. " : "Project check — nothing was sent. "}
        </strong>
        {prompt.detail}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {isMismatch ? (
          <>
            <button
              type="button"
              className={buttonClass}
              style={primaryStyle}
              onClick={() => onConfirm("switch")}
            >
              Switch to {conversationName}
            </button>
            {prompt.viewedProject && (
              <button
                type="button"
                className={buttonClass}
                style={quietStyle}
                onClick={() => onConfirm("rebind")}
              >
                Move this chat to {viewedName}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className={buttonClass}
            style={primaryStyle}
            onClick={() => onConfirm("rebind")}
          >
            {prompt.conversationProject
              ? `Move this chat to ${targetName}`
              : `Tie this chat to ${targetName}`}
          </button>
        )}
        <button
          type="button"
          className={buttonClass}
          style={quietStyle}
          onClick={onDismiss}
        >
          Stay — don&apos;t send
        </button>
      </div>
    </div>
  );
}
