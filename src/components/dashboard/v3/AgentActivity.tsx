"use client";

import { CheckCircle2, CircleAlert, Clock3, Loader2 } from "lucide-react";
import type { ActivityItem } from "@/lib/mission-control";

export function AgentActivity({ items, loading }: { items: ActivityItem[]; loading: boolean }) {
  return <section className="rounded-xl border p-5" style={{ background: "rgba(18,18,21,.72)", borderColor: "rgba(255,255,255,.07)", backdropFilter: "blur(12px)" }}>
    <div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold uppercase tracking-[.18em] text-zinc-300">Agent activity</h2><span className="text-[10px] uppercase tracking-widest text-zinc-600">Live feed</span></div>
    {loading ? <div className="space-y-3">{[1, 2, 3].map((row) => <div key={row} className="h-9 animate-pulse rounded bg-white/[.04]" />)}</div> : items.length === 0 ? <div className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-500">No agent activity yet. Start a build above and the timeline will appear here.</div> : <div className="space-y-3">{items.slice(0, 5).map((item) => { const Icon = item.severity === "success" ? CheckCircle2 : item.severity === "error" ? CircleAlert : item.severity === "warning" ? Clock3 : Loader2; const iconColor = item.severity === "success" ? "#34d399" : item.severity === "error" ? "#f87171" : "#a8ff2f"; return <div key={item.id} className="flex gap-3"><Icon size={15} className="mt-0.5 shrink-0" style={{ color: iconColor }} /><div className="min-w-0"><p className="truncate text-sm text-zinc-200">{item.title}</p>{item.detail && <p className="truncate text-xs text-zinc-500">{item.detail}</p>}</div><time className="ml-auto shrink-0 text-[10px] text-zinc-600">{new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></div>; })}</div>}
  </section>;
}
