"use client";

import { CheckCircle2, CircleAlert, Clock3, Loader2 } from "lucide-react";
import type { ActivityItem } from "@/lib/mission-control";
import { useTheme } from "@/context/ThemeContext";

export function AgentActivity({ items, loading }: { items: ActivityItem[]; loading: boolean }) {
  // Theme-token driven (was hard-coded dark glass): follows the applied
  // theme — light under the default LiTT Signature theme. Severity icon
  // colors are state semantics; the neutral one follows the accent.
  const { resolvedColors } = useTheme();
  return <section className="rounded-xl border p-5" style={{ background: resolvedColors.boxBg, borderColor: resolvedColors.borderColor }}>
    <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-[.18em]" style={{ color: resolvedColors.textColor }}>Agent activity</h2><span className="text-[10px] uppercase tracking-widest" style={{ color: resolvedColors.textMuted }}>Live feed</span></div>
    {loading ? <div className="space-y-3">{[1, 2, 3].map((row) => <div key={row} className="h-9 animate-pulse rounded" style={{ background: `${resolvedColors.textColor}0d` }} />)}</div> : items.length === 0 ? <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm" style={{ borderColor: resolvedColors.borderColor, color: resolvedColors.textMuted }}>No agent activity yet. Start a build above and the timeline will appear here.</div> : <div className="space-y-3">{items.slice(0, 5).map((item) => { const Icon = item.severity === "success" ? CheckCircle2 : item.severity === "error" ? CircleAlert : item.severity === "warning" ? Clock3 : Loader2; const iconColor = item.severity === "success" ? "#34d399" : item.severity === "error" ? "#f87171" : resolvedColors.accentColor; return <div key={item.id} className="flex gap-3"><Icon size={15} className="mt-0.5 shrink-0" style={{ color: iconColor }} /><div className="min-w-0"><p className="truncate text-sm" style={{ color: resolvedColors.textColor }}>{item.title}</p>{item.detail && <p className="truncate text-xs" style={{ color: resolvedColors.textMuted }}>{item.detail}</p>}</div><time className="ml-auto shrink-0 text-[10px]" style={{ color: resolvedColors.textMuted }}>{new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>; })}</div>}
  </section>;
}
