"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Activity, ArrowRight, Bot, Clock3, Filter, MessageSquare, Search, Sparkles, Terminal } from "lucide-react";

type AgentStatus = { name: string; role: string; status: "running" | "idle"; lastAction: string; uptime: string };
const statusMeta = { running: { label: "Working", color: "#22d3ee" }, idle: { label: "Ready", color: "#34d399" } } as const;

export default function AgentsPage() {
  const { resolvedColors: T } = useTheme();
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "running" | "idle">("All");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/agents/status");
        const data = await res.json();
        if (alive) setAgents(Array.isArray(data) ? data : []);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agents.filter((agent) => {
      const matchesSearch = !q || agent.name.toLowerCase().includes(q) || agent.role.toLowerCase().includes(q) || agent.lastAction.toLowerCase().includes(q);
      const matchesFilter = filter === "All" || agent.status === filter;
      return matchesSearch && matchesFilter;
    });
  }, [agents, search, filter]);

  const onlineCount = agents.filter((a) => a.status === "running").length;

  return (
    <main className="min-h-screen pb-12" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <section className="relative overflow-hidden border-b" style={{ borderColor: T.borderColor + "20" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at top left, rgba(34,211,238,0.12), transparent 35%), radial-gradient(circle at top right, rgba(249,115,22,0.12), transparent 30%)" }} />
        <div className="relative max-w-7xl mx-auto px-4 py-10 md:py-14">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em]" style={{ backgroundColor: T.accentColor + "12", border: `1px solid ${T.accentColor}30`, color: T.accentColor }}>
                <Sparkles size={12} /> {onlineCount}/{agents.length || 0} online
              </div>
              <h1 className="mt-4 text-4xl md:text-6xl font-black tracking-tight" style={{ color: T.headerColor }}>Agent Command Center</h1>
              <p className="mt-4 max-w-2xl text-base md:text-lg opacity-75">A real roster for your AI team. Search, filter, and jump into the right specialist without digging through hidden pages.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Online" value={onlineCount} accent={T.accentColor} />
              <StatCard label="Tracked" value={agents.length} accent={T.linkColor} />
              <StatCard label="Mode" value="Live" accent={T.headerColor} />
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 pt-5">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-xl">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: T.textMuted }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search agents, roles, or recent actions..." className="w-full pl-9 pr-4 py-3 rounded-xl text-sm outline-none" style={{ backgroundColor: T.boxBg + "50", border: `1px solid ${T.borderColor}30`, color: T.textColor }} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} style={{ color: T.textMuted }} />
            {(["All", "running", "idle"] as const).map((item) => (
              <button key={item} onClick={() => setFilter(item)} className="px-3 py-2 rounded-xl text-xs font-bold capitalize" style={{ backgroundColor: filter === item ? T.accentColor + "15" : T.boxBg + "35", color: filter === item ? T.accentColor : T.textMuted, border: `1px solid ${filter === item ? T.accentColor + "35" : T.borderColor + "25"}` }}>{item}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 mt-6">
        {loading ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-56 rounded-3xl border animate-pulse" style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "20" }} />)}</div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredAgents.map((agent) => {
              const meta = statusMeta[agent.status];
              return (
                <article key={agent.name} className="group rounded-3xl border p-5 transition-transform duration-200 hover:-translate-y-1" style={{ backgroundColor: T.boxBg, borderColor: T.borderColor + "25" }}>
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: meta.color + "15", border: `1px solid ${meta.color}30` }}><Bot size={20} style={{ color: meta.color }} /></div>
                    <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: meta.color }} /><span className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: meta.color }}>{meta.label}</span></div>
                  </div>
                  <h2 className="mt-4 text-2xl font-black" style={{ color: T.headerColor }}>{agent.name}</h2>
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: T.textMuted }}>{agent.role}</p>
                  <p className="mt-4 text-sm leading-relaxed" style={{ color: T.textColor }}>{agent.lastAction}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl p-3" style={{ backgroundColor: T.bgColor + "60" }}><div className="flex items-center gap-1.5 opacity-60"><Clock3 size={11} /> Uptime</div><div className="mt-1 font-black">{agent.uptime}</div></div>
                    <div className="rounded-xl p-3" style={{ backgroundColor: T.bgColor + "60" }}><div className="flex items-center gap-1.5 opacity-60"><Activity size={11} /> Status</div><div className="mt-1 font-black capitalize">{agent.status}</div></div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <Link href={`/agents/${agent.name.toLowerCase().replace(/\s+/g, "-")}`} className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold" style={{ backgroundColor: meta.color + "15", color: meta.color, border: `1px solid ${meta.color}30` }}><MessageSquare size={14} /> Chat</Link>
                    <Link href="/studio?tool=agents" className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold" style={{ backgroundColor: T.bgColor + "60", color: T.textMuted, border: `1px solid ${T.borderColor}30` }}><Terminal size={14} /> Open</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="max-w-7xl mx-auto px-4 mt-8">
        <div className="rounded-3xl border p-5 md:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4" style={{ background: "linear-gradient(135deg, rgba(34,211,238,0.08), rgba(249,115,22,0.06))", borderColor: T.borderColor + "25" }}>
          <div><div className="text-xs font-black uppercase tracking-[0.24em]" style={{ color: T.accentColor }}>Next step</div><p className="mt-2 text-sm opacity-80">Use the agent cards to chat, or launch the Studio agents tool for a more hands-on workspace.</p></div>
          <div className="flex items-center gap-2"><Link href="/studio?tool=agents" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>Launch Studio <ArrowRight size={14} /></Link><Link href="/gallery" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold" style={{ backgroundColor: T.boxBg + "50", color: T.textColor, border: `1px solid ${T.borderColor}30` }}>Browse Gallery</Link></div>
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return <div className="min-w-[92px] rounded-2xl border p-3" style={{ backgroundColor: "rgba(255,255,255,0.02)", borderColor: `${accent}25` }}><div className="text-2xl font-black" style={{ color: accent }}>{value}</div><div className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] opacity-60">{label}</div></div>;
}
