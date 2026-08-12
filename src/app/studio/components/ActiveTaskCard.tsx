"use client";

import { useState } from "react";

/**
 * ActiveTaskCard — renders real tool activity for an assistant message.
 *
 * Only appears when message.toolActivity has actual entries.
 * Never renders for conversational messages with no tool execution.
 *
 * States are derived from the tool activity log:
 *   - Streaming + no tools yet → Thinking
 *   - Tools running → Working
 *   - Tools done + awaiting approval → Waiting for approval
 *   - All tools succeeded → Done
 *   - Any tool failed → Failed
 */

interface ToolActivityEntry {
  toolId: string;
  success?: boolean;
  summary: string;
}

interface ActiveTaskCardProps {
  toolActivity: ToolActivityEntry[] | null | undefined;
  isStreaming: boolean;
  isFailed: boolean;
  pendingApproval?: { toolId: string; reason: string } | null;
  agentColor: string;
}

function ToolIcon({ toolId, size = 10 }: { toolId: string; size?: number }) {
  // Map tool IDs to simple labels
  const label = toolId.replace(/^(files|git|build|test|lint|typecheck|search|project|apply)\./, "$1 ");
  return <span className="font-mono text-[9px] uppercase tracking-wide">{label}</span>;
}

function StatusDot({ state, color }: { state: "thinking" | "working" | "approval" | "done" | "failed"; color: string }) {
  const bgColor =
    state === "failed" ? "#ef4444"
    : state === "approval" ? "#e3b341"
    : state === "done" ? "#22c55e"
    : state === "working" ? color
    : "rgba(255,255,255,0.4)";
  const animate = state === "thinking" || state === "working";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${animate ? "animate-pulse" : ""}`}
      style={{ backgroundColor: bgColor }}
      aria-hidden
    />
  );
}

export function ActiveTaskCard({
  toolActivity,
  isStreaming,
  isFailed,
  pendingApproval,
  agentColor,
}: ActiveTaskCardProps) {
  const [expanded, setExpanded] = useState(true);

  // Don't render if no real tool activity and no pending approval
  const hasTools = !!toolActivity && toolActivity.length > 0;
  const hasApproval = !!pendingApproval;

  if (!hasTools && !hasApproval) return null;

  // Derive state
  const tools = toolActivity ?? [];
  const succeeded = tools.filter((t) => t.success === true).length;
  const failed = tools.filter((t) => t.success === false).length;
  const running = tools.filter((t) => t.success === undefined).length;

  let state: "thinking" | "working" | "approval" | "done" | "failed";
  let stateLabel: string;

  if (hasApproval) {
    state = "approval";
    stateLabel = "Waiting for approval";
  } else if (isFailed && failed > 0) {
    state = "failed";
    stateLabel = `${failed} step${failed > 1 ? "s" : ""} failed`;
  } else if (running > 0 || (isStreaming && hasTools)) {
    state = "working";
    stateLabel = `${succeeded + failed + running} of ${tools.length} step${tools.length > 1 ? "s" : ""}`;
  } else if (succeeded === tools.length && tools.length > 0) {
    state = "done";
    stateLabel = `${tools.length} step${tools.length > 1 ? "s" : ""} complete`;
  } else if (isStreaming && !hasTools) {
    state = "thinking";
    stateLabel = "Thinking";
  } else {
    state = "done";
    stateLabel = `${succeeded} of ${tools.length} complete`;
  }

  return (
    <div
      className="mt-2 rounded-xl border text-[10px]"
      style={{
        borderColor: state === "failed" ? "rgba(239,68,68,0.2)" : `${agentColor}15`,
        background: state === "failed" ? "rgba(239,68,68,0.04)" : `${agentColor}06`,
      }}
      data-testid="active-task-card"
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:opacity-80"
        aria-expanded={expanded}
      >
        <StatusDot state={state} color={agentColor} />
        <span
          className="font-bold uppercase tracking-[.1em]"
          style={{ color: state === "failed" ? "#ef4444" : state === "approval" ? "#e3b341" : "var(--text-muted)" }}
        >
          {stateLabel}
        </span>
        {tools.length > 0 && (
          <span className="ml-auto text-[8px] opacity-50">
            {expanded ? "collapse" : "expand"}
          </span>
        )}
      </button>

      {/* Tool activity list — collapsible */}
      {expanded && tools.length > 0 && (
        <div className="border-t px-3 py-2" style={{ borderColor: `${agentColor}10` }}>
          <ul className="flex flex-col gap-1.5">
            {tools.map((tool, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      tool.success === true ? "#22c55e"
                      : tool.success === false ? "#ef4444"
                      : agentColor,
                  }}
                  aria-hidden
                />
                <ToolIcon toolId={tool.toolId} />
                <span className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                  {tool.summary}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Approval reason */}
      {hasApproval && expanded && (
        <div className="border-t px-3 py-2 text-[9px]" style={{ borderColor: "#e3b34120", color: "#e3b341" }}>
          {pendingApproval!.reason}
        </div>
      )}
    </div>
  );
}
