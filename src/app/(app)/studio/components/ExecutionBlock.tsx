"use client";

import { useId, useState } from "react";

/**
 * Execution lane — the per-run execution block in the Studio transcript.
 *
 * Conversation (what LiTT says) and execution (what the run did) are
 * separate lanes: the reply renders in its prominent bubble, and everything
 * about the run's execution lives here in a visually distinct, subdued
 * block. The verdict line is derived from execution evidence ONLY — low-level
 * events sit behind the collapsed "Details" expander and never claim to be
 * the run's result.
 */

/**
 * One raw low-level record from a run — a tool call, build check, step tick,
 * retry, or internal status transition. Rendered as a factual record only:
 * it never claims to be the run's result.
 */
export interface ExecutionDetailRecord {
  /** Stable key for the row. */
  id: string;
  /** Factual one-line record — never a result claim. */
  summary: string;
  /** Dot color describing the record's outcome tone. */
  dotColor: string;
}

/** Outcome tone for a tool-activity record: green/red/amber, no new colors. */
export function toolActivityDotColor(success?: boolean): string {
  if (success === false) return "#ef4444";
  if (success === true) return "#4ade80";
  return "#e3b341";
}

/**
 * Collapsed-by-default expander for a run's raw low-level events.
 * Default view stays a concise block; the firehose is one tap away.
 */
export function ExecutionDetailsExpander({
  details,
}: {
  details: ExecutionDetailRecord[];
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (details.length === 0) return null;
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        data-testid="execution-details-toggle"
        className="flex items-center gap-1.5 text-[10px] font-bold transition hover:opacity-80"
        style={{ color: "var(--text-muted)" }}
      >
        <span
          className="inline-block h-0 w-0 border-y-[3px] border-l-[5px] border-y-transparent transition-transform"
          style={{ borderLeftColor: "var(--text-muted)", transform: open ? "rotate(90deg)" : "none" }}
          aria-hidden
        />
        Details
        <span className="font-normal opacity-70">· {details.length}</span>
      </button>
      {open && (
        <ul
          id={listId}
          data-testid="execution-details"
          className="mt-1.5 flex max-h-48 flex-col gap-1 overflow-y-auto"
        >
          {details.map((record) => (
            <li
              key={record.id}
              className="flex items-start gap-1.5 text-[10px] leading-4"
              style={{ color: "var(--text-muted)" }}
            >
              <span
                className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: record.dotColor }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">{record.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The execution lane for one completed (or failed) run: verdict line plus
 * the collapsed raw-event Details. Renders nothing when there is no verdict
 * — a conversational reply is not a run.
 */
export function ExecutionBlock({
  verdict,
  details,
}: {
  /** Evidence-derived verdict ({ label, color }), or null when no run happened. */
  verdict: { label: string; color: string } | null;
  /** Raw low-level records shown only behind the Details expander. */
  details: ExecutionDetailRecord[];
}) {
  if (!verdict) return null;
  return (
    <section
      data-testid="studio-execution-block"
      aria-label="Execution details"
      className="mt-1.5 w-full min-w-0 rounded-xl border px-3 py-2"
      style={{
        borderColor: "var(--studio-border, rgba(255,255,255,0.08))",
        backgroundColor: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 text-[9px] font-black uppercase tracking-[.14em]"
          style={{ color: "var(--text-muted)" }}
        >
          Execution
        </span>
        <div
          data-testid="studio-work-log"
          className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold"
          style={{ color: "var(--text-secondary)" }}
        >
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: verdict.color }}
            aria-hidden
          />
          <span className="min-w-0 truncate">Work log · {verdict.label}</span>
        </div>
      </div>
      <ExecutionDetailsExpander details={details} />
    </section>
  );
}
