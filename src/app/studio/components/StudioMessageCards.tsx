"use client";

import { useState } from "react";
import {
  ClipboardList,
  Activity,
  ShieldCheck,
  CircleCheck,
  ChevronDown,
  ChevronRight,
  Code2,
  GitBranch,
} from "lucide-react";

/**
 * StudioMessageCards — reusable placeholder components for the structured
 * message cards Phase 2 will populate with real run data.
 *
 * Phase 1 only renders the visual foundations. These components accept
 * either real data or static development fixtures (Storybook/tests) and
 * NEVER invent fake production execution results.
 *
 * Card types:
 *  - PlanCard       : a proposed plan with steps
 *  - ActivityCard   : a compact activity log entry
 *  - ApprovalCard   : a request requiring user approval
 *  - CompletionCard : a finished run summary
 */

export interface PlanStep {
  id: string;
  label: string;
  status?: "pending" | "active" | "done" | "skipped";
}

export interface PlanCardData {
  id: string;
  title: string;
  steps: PlanStep[];
  /** When true, the card is a static fixture and shows a "Fixture" tag. */
  fixture?: boolean;
}

export function PlanCard({ data }: { data: PlanCardData }) {
  const [open, setOpen] = useState(true);
  const done = data.steps.filter((s) => s.status === "done").length;
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "var(--studio-card)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/5"
        aria-expanded={open}
        aria-label={`Plan: ${data.title}`}
      >
        {open ? <ChevronDown size={14} style={{ color: "var(--text-muted)" }} /> : <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />}
        <ClipboardList size={14} style={{ color: "var(--litt-primary)" }} className="shrink-0" />
        <span className="flex-1 text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {data.title}
        </span>
        <span className="text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>
          {done}/{data.steps.length}
        </span>
        {data.fixture && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{ backgroundColor: "rgba(227,179,65,0.12)", color: "#e3b341" }}
          >
            Fixture
          </span>
        )}
      </button>
      {open && (
        <div className="border-t" style={{ borderColor: "var(--studio-border)" }}>
          {data.steps.map((step, i) => (
            <div
              key={step.id}
              className="flex items-center gap-2.5 px-3 py-2"
              style={{ borderTop: i > 0 ? "1px solid var(--studio-border)" : undefined }}
            >
              <StepDot status={step.status} />
              <span
                className="flex-1 text-[12px]"
                style={{
                  color: step.status === "done" ? "var(--text-secondary)" : "var(--text-primary)",
                  textDecoration: step.status === "skipped" ? "line-through" : undefined,
                }}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepDot({ status }: { status?: PlanStep["status"] }) {
  const color =
    status === "done" ? "var(--litt-primary)" :
    status === "active" ? "#22d3ee" :
    status === "skipped" ? "var(--text-muted)" :
    "var(--text-muted)";
  return (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full border"
      style={{ borderColor: color }}
      aria-hidden
    >
      {status === "done" && <CircleCheck size={11} style={{ color }} />}
      {status === "active" && (
        <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: color }} />
      )}
    </span>
  );
}

export interface ActivityEntry {
  id: string;
  label: string;
  detail?: string;
  timestamp?: string;
  kind?: "info" | "edit" | "command" | "warning";
}

export function ActivityCard({ entry }: { entry: ActivityEntry }) {
  const Icon = entry.kind === "edit" ? Code2 : entry.kind === "command" ? GitBranch : Activity;
  const accent =
    entry.kind === "warning" ? "#e3b341" :
    entry.kind === "edit" ? "var(--litt-primary)" :
    entry.kind === "command" ? "#22d3ee" :
    "var(--text-muted)";
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg border px-3 py-2"
      style={{
        backgroundColor: "var(--studio-card)",
        borderColor: "var(--studio-border)",
      }}
    >
      <Icon size={13} className="mt-0.5 shrink-0" style={{ color: accent }} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {entry.label}
        </div>
        {entry.detail && (
          <div className="text-[11px] leading-tight" style={{ color: "var(--text-secondary)" }}>
            {entry.detail}
          </div>
        )}
      </div>
      {entry.timestamp && (
        <span className="shrink-0 text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>
          {entry.timestamp}
        </span>
      )}
    </div>
  );
}

export interface ApprovalData {
  id: string;
  title: string;
  description: string;
  /** When true, the card is a static fixture and shows a "Fixture" tag. */
  fixture?: boolean;
}

export function ApprovalCard({
  data,
  onApprove,
  onReject,
}: {
  data: ApprovalData;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "var(--studio-card)",
        borderColor: "rgba(114,242,56,0.3)",
      }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b" style={{ borderColor: "var(--studio-border)" }}>
        <ShieldCheck size={14} style={{ color: "var(--litt-primary)" }} className="shrink-0" />
        <span className="flex-1 text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {data.title}
        </span>
        {data.fixture && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{ backgroundColor: "rgba(227,179,65,0.12)", color: "#e3b341" }}
          >
            Fixture
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {data.description}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onApprove}
            className="rounded-lg px-3 py-1.5 text-[11px] font-black transition hover:opacity-90"
            style={{ backgroundColor: "var(--litt-primary)", color: "#000" }}
            aria-label="Approve"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onReject}
            className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition hover:bg-white/5"
            style={{ borderColor: "var(--studio-border-strong)", color: "var(--text-secondary)" }}
            aria-label="Reject"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

export interface CompletionData {
  id: string;
  title: string;
  summary: string;
  checksPassed?: number;
  checksTotal?: number;
  fixture?: boolean;
}

export function CompletionCard({ data }: { data: CompletionData }) {
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        backgroundColor: "var(--studio-card)",
        borderColor: "rgba(114,242,56,0.3)",
      }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b" style={{ borderColor: "var(--studio-border)" }}>
        <CircleCheck size={14} style={{ color: "var(--litt-primary-strong)" }} className="shrink-0" />
        <span className="flex-1 text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
          {data.title}
        </span>
        {data.fixture && (
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{ backgroundColor: "rgba(227,179,65,0.12)", color: "#e3b341" }}
          >
            Fixture
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {data.summary}
        </p>
        {typeof data.checksPassed === "number" && typeof data.checksTotal === "number" && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: "var(--studio-elevated)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(data.checksPassed / data.checksTotal) * 100}%`,
                  backgroundColor: "var(--litt-primary)",
                }}
              />
            </div>
            <span className="text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>
              {data.checksPassed}/{data.checksTotal} checks
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Static development fixtures (Storybook/tests only) ────────── */
export const PLAN_FIXTURE: PlanCardData = {
  id: "fixture-plan",
  title: "Fix mobile Studio layout",
  fixture: true,
  steps: [
    { id: "1", label: "Inspect current mobile layout", status: "done" },
    { id: "2", label: "Identify composer overflow", status: "active" },
    { id: "3", label: "Apply safe-area padding", status: "pending" },
    { id: "4", label: "Verify on 390×844", status: "pending" },
  ],
};

export const APPROVAL_FIXTURE: ApprovalData = {
  id: "fixture-approval",
  title: "Apply edit to StudioOS.tsx",
  description: "LiTT wants to add safe-area padding to the mobile composer wrapper. Approve to apply this edit.",
  fixture: true,
};

export const COMPLETION_FIXTURE: CompletionData = {
  id: "fixture-completion",
  title: "Mobile layout repaired",
  summary: "Composer now respects safe-area insets and stays visible above the keyboard on 390×844 and 360×800.",
  checksPassed: 4,
  checksTotal: 4,
  fixture: true,
};

export const ACTIVITY_FIXTURES: ActivityEntry[] = [
  { id: "a1", label: "read_file StudioOS.tsx", detail: "src/app/studio/components/StudioOS.tsx", kind: "command", timestamp: "0:02" },
  { id: "a2", label: "apply_patch", detail: "Added safe-area padding to mobile composer wrapper", kind: "edit", timestamp: "0:04" },
  { id: "a3", label: "run_typecheck", detail: "npx tsc --noEmit — passed", kind: "info", timestamp: "0:06" },
];
