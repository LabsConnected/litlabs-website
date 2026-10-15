"use client";

import {
  AlertCircle,
  Check,
  CircleDot,
  FileCode2,
  FolderOpen,
  Globe2,
  Hammer,
  Loader2,
  Rocket,
  TerminalSquare,
} from "lucide-react";
import type { ChatMessage } from "../stores/useStudioAgentStore";

type ToolActivity = NonNullable<ChatMessage["toolActivity"]>[number];

function iconFor(toolId: string) {
  const key = toolId.toLowerCase();
  if (key.includes("browser") || key.includes("web")) return Globe2;
  if (key.includes("terminal") || key.includes("command") || key.includes("shell")) return TerminalSquare;
  if (key.includes("file") || key.includes("code")) return FileCode2;
  if (key.includes("preview") || key.includes("deploy")) return Rocket;
  if (key.includes("test") || key.includes("build")) return Hammer;
  if (key.includes("asset") || key.includes("folder")) return FolderOpen;
  return CircleDot;
}

function stateFor(record: ToolActivity, messageStatus: ChatMessage["status"]): {
  label: string;
  color: string;
  running: boolean;
} {
  if (record.success === true) return { label: "Completed", color: "#86efac", running: false };
  if (record.success === false) return { label: "Needs attention", color: "#fca5a5", running: false };
  if (messageStatus === "pending" || messageStatus === "streaming" || messageStatus === "awaiting_approval") {
    return { label: "In progress", color: "#fde68a", running: true };
  }
  // An old record with no outcome is not promoted to success after the fact.
  return { label: "Recorded", color: "var(--text-muted)", running: false };
}

export default function ConversationActivityCards({
  activity,
  messageStatus,
}: {
  activity?: ChatMessage["toolActivity"];
  messageStatus?: ChatMessage["status"];
}) {
  if (!activity?.length) return null;

  return (
    <div
      className="mt-3 grid min-w-0 gap-1.5"
      data-testid="conversation-activity-cards"
      aria-label="LiTT activity"
    >
      {activity.map((record, index) => {
        const Icon = iconFor(record.toolId);
        const state = stateFor(record, messageStatus);
        return (
          <div
            key={`${record.toolId}-${index}`}
            className="flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px]"
            data-testid="conversation-activity-card"
            data-state={record.success === false ? "failed" : state.running ? "running" : record.success === true ? "completed" : "recorded"}
            style={{
              borderColor: record.success === false ? "rgba(239,68,68,0.24)" : "rgba(155,77,255,0.16)",
              backgroundColor: "rgba(255,255,255,0.025)",
            }}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: "rgba(155,77,255,0.10)", color: state.color }}>
              {state.running ? <Loader2 size={13} className="animate-spin" aria-hidden /> : record.success === false ? <AlertCircle size={13} aria-hidden /> : record.success === true ? <Check size={13} aria-hidden /> : <Icon size={13} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 truncate" title={record.summary || record.toolId}>
              {record.summary?.trim() || record.toolId.replace(/[_-]/g, " ")}
            </span>
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: state.color }}>
              {state.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
