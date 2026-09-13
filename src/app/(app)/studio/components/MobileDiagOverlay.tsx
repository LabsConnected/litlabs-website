"use client";

/**
 * TEMPORARY on-screen diagnostic HUD for isolating a real-phone Studio
 * failure without an attached devtools console. Shows the most recent
 * mobile diagnostic events (see lib/mobileDiagnostics.ts) and lets the
 * tester copy the full ring buffer to their clipboard.
 *
 * Remove this component and its mount point once mobile Studio is
 * confirmed working end-to-end on device.
 */

import { useEffect, useState } from "react";
import { getMobileDiagLog, subscribeMobileDiag, formatMobileDiagLog, type MobileDiagEntry } from "../lib/mobileDiagnostics";

export default function MobileDiagOverlay() {
  const [entries, setEntries] = useState<MobileDiagEntry[]>(() => getMobileDiagLog());
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeMobileDiag(() => setEntries(getMobileDiagLog())), []);

  const last = entries[entries.length - 1];

  return (
    <div
      className="fixed z-[10030] max-w-[92vw] overflow-hidden rounded-lg border font-mono text-[9px] shadow-xl"
      style={{
        left: 8,
        bottom: "calc(var(--studio-mobile-bottom-h, 62px) + env(safe-area-inset-bottom) + 12px)",
        backgroundColor: "rgba(8,9,13,0.92)",
        borderColor: "rgba(139,92,246,0.4)",
        color: "#e5e7eb",
      }}
      data-testid="mobile-diag-overlay"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
        aria-expanded={expanded}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: last ? categoryColor(last.category) : "#4b5563" }}
          aria-hidden
        />
        <span className="truncate">
          {last ? `[${last.category}] ${last.event}` : "diag: no events yet"}
        </span>
      </button>
      {expanded && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-white/10 px-2 py-1.5">
          {entries.length === 0 && <div className="opacity-60">Nothing logged yet.</div>}
          {entries.slice(-20).reverse().map((e, i) => (
            <div key={i} className="mb-1 leading-tight">
              <span style={{ color: categoryColor(e.category) }}>[{e.category}]</span>{" "}
              <span>{e.event}</span>
              {e.detail && (
                <span className="opacity-60"> {JSON.stringify(e.detail)}</span>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(formatMobileDiagLog()).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }).catch(() => {});
            }}
            className="mt-1 rounded border border-white/20 px-2 py-1 font-sans text-[10px] font-bold"
          >
            {copied ? "Copied" : "Copy log"}
          </button>
        </div>
      )}
    </div>
  );
}

function categoryColor(category: MobileDiagEntry["category"]): string {
  switch (category) {
    case "auth": return "#ef4444";
    case "project": return "#f59e0b";
    case "chat_api": return "#3b82f6";
    case "streaming": return "#22d3ee";
    case "composer": return "#a855f7";
    case "viewport": return "#72f238";
    default: return "#9ca3af";
  }
}
