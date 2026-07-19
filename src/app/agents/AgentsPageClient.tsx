"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS, type Agent } from "@/lib/agents";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  XCircle,
} from "lucide-react";

type TaskStatus = "queued" | "processing" | "success" | "failed" | "cancelled";
type Mission = {
  id: string;
  session_id: string;
  assigned_to: string;
  dispatcher: string;
  task_input: { prompt?: string; context?: Record<string, unknown>; agentSlug?: string };
  task_output?: { text?: string; critical_fault?: string };
  status: TaskStatus;
  created_at: string;
  updated_at: string;
};

const CORE_AGENTS = [AGENTS.litt].filter(Boolean);

function routeTask(_task: string) { return AGENTS.litt; }

function statusMeta(status: TaskStatus) {
  switch (status) {
    case "processing": return { label: "Running", color: "#22d3ee", icon: Activity };
    case "success": return { label: "Completed", color: "#34d399", icon: CheckCircle2 };
    case "failed": return { label: "Failed", color: "#fb7185", icon: XCircle };
    case "cancelled": return { label: "Cancelled", color: "#94a3b8", icon: XCircle };
    default: return { label: "Queued", color: "#fbbf24", icon: Clock3 };
  }
}

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function AgentsPageClient() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  const [command, setCommand] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<string>("auto");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [installedCount, setInstalledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const [tasksResult, agentsResult] = await Promise.allSettled([
      fetch("/api/agent-tasks", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Could not load missions");
        return response.json();
      }),
      fetch("/api/user-agents", { cache: "no-store" }).then((response) => response.ok ? response.json() : { agents: [] }),
    ]);
    if (tasksResult.status === "fulfilled") {
      setMissions(tasksResult.value.tasks || []);
      setError(null);
    } else {
      setError(tasksResult.reason instanceof Error ? tasksResult.reason.message : "Could not load missions");
    }
    if (agentsResult.status === "fulfilled") setInstalledCount(agentsResult.value.agents?.length || 0);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => void loadData(true), 10_000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const submitMission = async () => {
    const prompt = command.trim();
    if (prompt.length < 4 || submitting) return;
    const agent = selectedAgent === "auto" ? routeTask(prompt) : AGENTS[selectedAgent];
    if (!agent) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/agent-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: crypto.randomUUID(),
          assignedTo: agent.id,
          dispatcher: selectedAgent === "auto" ? "litt" : "user",
          taskInput: { prompt, context: { source: "agents-page" }, agentSlug: agent.id },
          meta: { source: "crew-command-center" },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Mission could not be queued");
      setCommand("");
      await loadData(true);
    } catch (missionError) {
      setError(missionError instanceof Error ? missionError.message : "Mission could not be queued");
    } finally {
      setSubmitting(false);
    }
  };

  const activeMissions = useMemo(() => missions.filter((mission) => mission.status === "queued" || mission.status === "processing"), [missions]);
  const completedMissions = useMemo(() => missions.filter((mission) => mission.status === "success").length, [missions]);

  const openInStudio = (agent: Agent, prompt = "") => {
    const params = new URLSearchParams({ tool: "chat", agent: agent.id });
    if (prompt) params.set("mission", prompt);
    router.push(`/studio?${params.toString()}`);
  };

  return (
    <main className="relative h-full overflow-y-auto pb-24" style={{ backgroundColor: "transparent", color: T.textColor }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 15% 15%, ${T.accentColor}10, transparent 32%), radial-gradient(circle at 85% 40%, ${T.linkColor}0b, transparent 30%)` }} />
      <div className="relative mx-auto max-w-7xl space-y-6 px-4 py-6 sm:py-8">
        <header className="relative min-h-56 overflow-hidden rounded-3xl border p-5 sm:min-h-64 sm:p-8" style={{ borderColor: `${T.accentColor}30`, backgroundColor: "#050805" }}>
          <Image src="/brand/litt-mascot-character-sheet.png" alt="LiTT character poses" fill priority className="object-cover opacity-80" style={{ objectPosition: "58% 24%" }} />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,5,.98)_0%,rgba(3,7,5,.88)_38%,rgba(3,7,5,.2)_72%,rgba(3,7,5,.55)_100%)]" />
          <div className="relative z-10 flex max-w-xl items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: `linear-gradient(135deg, ${T.accentColor}, ${T.linkColor})`, boxShadow: `0 0 28px ${T.accentColor}30` }}><Users size={22} color="#fff" /></div>
            <div><p className="text-[9px] font-black uppercase tracking-[.22em] text-lime-300">Meet LiTT</p><h1 className="text-2xl font-black text-white sm:text-4xl">Your AI Crew</h1><p className="mt-2 max-w-md text-xs leading-5 text-white/60">LiTT directs the mission, chooses the right specialist, and keeps the work moving from idea to result.</p></div>
          </div>
          <div className="absolute bottom-5 left-5 z-10 flex gap-2 sm:bottom-8 sm:left-8">
            <button onClick={() => void loadData()} className="rounded-xl border p-2.5" style={{ borderColor: `${T.borderColor}35`, color: T.textMuted }} aria-label="Refresh missions"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
            <Link href="/studio?intent=agent" className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black" style={{ borderColor: `${T.borderColor}35`, color: T.textColor }}><Plus size={14} /> Create agent</Link>
          </div>
        </header>

        <section className="overflow-hidden rounded-3xl border p-4 sm:p-6" style={{ background: `linear-gradient(135deg, ${T.boxBg}, ${T.accentColor}08)`, borderColor: `${T.accentColor}30` }}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black" style={{ color: T.headerColor }}>Start a mission</h2><p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>Auto-route it or choose the exact agent.</p></div><div className="flex gap-2 text-[9px]"><span className="rounded-full border px-2.5 py-1" style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}>{activeMissions.length} active</span><span className="rounded-full border px-2.5 py-1" style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}>{completedMissions} completed</span><span className="rounded-full border px-2.5 py-1" style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}>{installedCount + CORE_AGENTS.length} available</span></div></div>
          <div className="mt-5 flex flex-wrap gap-2">
            {[{ id: "auto", name: "LiTT auto", icon: Sparkles }, ...CORE_AGENTS.map((agent) => ({ id: agent.id, name: agent.name, icon: Brain }))].map((option) => { const Icon = option.icon; const active = selectedAgent === option.id; return <button key={option.id} onClick={() => setSelectedAgent(option.id)} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold" style={{ borderColor: active ? T.accentColor : `${T.borderColor}30`, backgroundColor: active ? `${T.accentColor}15` : `${T.bgColor}55`, color: active ? T.accentColor : T.textMuted }}><Icon size={13} />{option.name}</button>; })}
          </div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submitMission(); }} rows={3} placeholder="Describe an outcome: fix mobile navigation, research a launch plan, review my API…" className="min-h-24 flex-1 resize-none rounded-2xl border bg-transparent px-4 py-3 text-sm outline-none" style={{ borderColor: `${T.borderColor}35`, color: T.textColor }} />
            <button onClick={() => void submitMission()} disabled={command.trim().length < 4 || submitting} className="flex min-w-40 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black disabled:opacity-40" style={{ backgroundColor: T.accentColor, color: T.bgColor }}>{submitting ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Queue mission</button>
          </div>
          {error && <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs text-rose-300"><AlertCircle size={13} />{error}</div>}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-[.16em]" style={{ color: T.textMuted }}>Crew</h2><Link href="/marketplace" className="text-[10px] font-bold" style={{ color: T.accentColor }}>Browse agents <ArrowRight size={10} className="inline" /></Link></div>
          <div className="grid gap-4 lg:grid-cols-2">
            {CORE_AGENTS.map((agent) => {
              const agentMissions = missions.filter((mission) => mission.assigned_to === agent.id);
              const running = agentMissions.find((mission) => mission.status === "processing");
              const queued = agentMissions.filter((mission) => mission.status === "queued").length;
              return <article key={agent.id} className="rounded-3xl border p-5" style={{ backgroundColor: `${T.boxBg}cc`, borderColor: `${agent.color}35` }}>
                <div className="flex items-start gap-4"><div className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl" style={{ background: `linear-gradient(135deg, ${agent.color}dd, ${agent.color}66)`, boxShadow: `0 0 24px ${agent.color}25` }}><Image src="/brand/litt-mascot-hero.png" alt="LiTT" fill className="object-cover" style={{ objectPosition: "50% 13%" }} /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-xl font-black" style={{ color: T.headerColor }}>{agent.name}</h3><span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-cyan-300" : "bg-emerald-400"}`} /></div><p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: agent.color }}>{agent.role}</p><p className="mt-1 text-[10px]" style={{ color: T.textMuted }}>{running ? "Running a mission" : queued ? `${queued} queued` : "Ready"}</p></div></div>
                <div className="mt-4 flex flex-wrap gap-1.5">{agent.domains.slice(0, 6).map((domain) => <span key={domain} className="rounded-full border px-2 py-1 text-[8px]" style={{ borderColor: `${T.borderColor}25`, color: T.textMuted }}>{domain}</span>)}</div>
                <div className="mt-4 rounded-xl border p-3" style={{ borderColor: `${T.borderColor}20`, backgroundColor: `${T.bgColor}55` }}><p className="text-[9px] font-black uppercase tracking-wider" style={{ color: T.textMuted }}>{running ? "Current mission" : "Latest activity"}</p><p className="mt-1 truncate text-xs font-bold" style={{ color: T.textColor }}>{running?.task_input?.prompt || agentMissions[0]?.task_input?.prompt || "No missions yet"}</p></div>
                <div className="mt-4 flex gap-2"><button onClick={() => { setSelectedAgent(agent.id); document.querySelector("textarea")?.focus(); }} className="flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-black" style={{ backgroundColor: `${agent.color}16`, color: agent.color, border: `1px solid ${agent.color}35` }}><Target size={13} /> Assign mission</button><button onClick={() => openInStudio(agent)} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black" style={{ borderColor: `${T.borderColor}30`, color: T.textColor }}>Open Studio <ArrowRight size={12} /></button></div>
              </article>;
            })}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-black uppercase tracking-[.16em]" style={{ color: T.textMuted }}>Mission activity</h2><p className="mt-1 text-[9px]" style={{ color: T.textMuted }}>Live queue state from the agent task system. No invented percentages or ETAs.</p></div>{missions.length > 0 && <span className="text-[9px]" style={{ color: T.textMuted }}>{missions.length} total</span>}</div>
          {loading && missions.length === 0 ? <div className="grid min-h-40 place-items-center rounded-2xl border" style={{ borderColor: `${T.borderColor}25` }}><Loader2 className="animate-spin" size={20} style={{ color: T.accentColor }} /></div> : missions.length === 0 ? <div className="rounded-3xl border border-dashed p-10 text-center" style={{ borderColor: `${T.borderColor}35`, backgroundColor: `${T.boxBg}55` }}><Bot size={28} className="mx-auto opacity-35" /><h3 className="mt-3 text-sm font-black">No real missions yet</h3><p className="mt-1 text-xs" style={{ color: T.textMuted }}>Your first queued mission will appear here and update automatically.</p></div> : <div className="space-y-2">{missions.map((mission) => { const meta = statusMeta(mission.status); const StatusIcon = meta.icon; const agent = AGENTS[mission.assigned_to]; return <article key={mission.id} className="rounded-2xl border p-4" style={{ backgroundColor: `${T.boxBg}aa`, borderColor: `${T.borderColor}25` }}><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${meta.color}14`, color: meta.color }}><StatusIcon size={15} className={mission.status === "processing" ? "animate-pulse" : ""} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="max-w-2xl truncate text-xs font-black" style={{ color: T.textColor }}>{mission.task_input?.prompt || "Untitled mission"}</h3><span className="rounded-full px-2 py-0.5 text-[8px] font-black uppercase" style={{ backgroundColor: `${meta.color}14`, color: meta.color }}>{meta.label}</span></div><p className="mt-1 text-[9px]" style={{ color: T.textMuted }}>{agent?.name || mission.assigned_to} · {relativeTime(mission.created_at)}</p>{mission.task_output?.text && <p className="mt-2 line-clamp-2 text-[10px] leading-4" style={{ color: T.textMuted }}>{mission.task_output.text}</p>}{mission.task_output?.critical_fault && <p className="mt-2 text-[10px] text-rose-300">{mission.task_output.critical_fault}</p>}</div>{agent && <button onClick={() => openInStudio(agent, mission.task_input?.prompt)} className="rounded-xl border p-2" style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }} aria-label="Continue in Studio"><ArrowRight size={13} /></button>}</div></article>; })}</div>}
        </section>
      </div>
    </main>
  );
}
