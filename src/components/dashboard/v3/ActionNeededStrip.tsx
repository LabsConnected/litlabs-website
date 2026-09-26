"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { PulseItem } from "./types";

/**
 * ActionNeededStrip — the dashboard's ONLY status surface.
 *
 * Renders nothing unless something genuinely needs the user's attention
 * (a failed build, an unreachable deployment, a dead terminal). Idle
 * telemetry, unknown states, and healthy green checks never appear here —
 * that information lives in Studio's mission control.
 */

const ACTION_COPY: Record<string, string> = {
  build: "Your build failed.",
  railway: "Deployment isn't reachable.",
  terminal: "The terminal connection failed.",
};

export function ActionNeededStrip({
  items,
  loading,
}: {
  items: PulseItem[];
  loading: boolean;
}) {
  if (loading) return null;
  const failed = items.filter((item) => item.state === "failed");
  if (failed.length === 0) return null;

  return (
    <section
      aria-live="polite"
      aria-label="Needs your attention"
      data-testid="action-needed-strip"
      className="rounded-2xl border p-4 md:p-5"
      style={{
        borderColor: "rgba(248,113,113,.28)",
        background:
          "linear-gradient(135deg, rgba(66,20,20,.72), rgba(20,12,12,.72))",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="flex items-center gap-4">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
          style={{ background: "rgba(248,113,113,.12)" }}
          aria-hidden
        >
          <AlertTriangle size={18} style={{ color: "#f87171" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[15px] font-bold tracking-tight"
            style={{ color: "#fafafa" }}
          >
            Something needs attention
          </p>
          <p
            className="mt-0.5 truncate text-[13px]"
            style={{ color: "#a1a1aa" }}
            title={failed.map((i) => ACTION_COPY[i.id] ?? i.label).join(" ")}
          >
            {failed.map((i) => ACTION_COPY[i.id] ?? i.label).join(" ")}
          </p>
        </div>
        <Link
          href="/studio"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-4 py-2.5 text-[13px] font-bold transition hover:brightness-125"
          style={{
            borderColor: "rgba(168,255,47,.35)",
            color: "#a8ff2f",
            background: "rgba(168,255,47,.06)",
          }}
        >
          Open Studio <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
