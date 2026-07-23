"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Cloud,
  Code2,
  FolderGit2,
  GitBranch,
  ImageIcon,
  Loader2,
  Mic,
  Play,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  Upload,
  Wallet,
  Wrench,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useProfile } from "@/context/ProfileContext";
import { useAppUser } from "@/hooks/useClerkAuth";
import { LiTTMessageAvatar } from "@/components/chat/MessageAvatar";

type Project = { id: string; owner?: string; repository?: string; status?: string; updated_at?: string };
type AgentTask = { id: string; assigned_to?: string; status?: string; task_input?: { prompt?: string }; updated_at?: string; created_at?: string };
type Deployment = { id: string; status?: string; project_name?: string; created_at?: string };
type DailyUsage = { date: string; commands: number; agentTasks: number; generations: number };
type CreationMode = "chat" | "builder" | "image" | "project" | "agent";

type WorkspaceData = {
  projects: Project[];
  tasks: AgentTask[];
  deployments: Deployment[];
  agents: number;
  balance: number | null;
  plan: string;
  commands: number;
  generations: number;
  tasksCompleted: number;
  daily: DailyUsage[];
  runtimeOnline: boolean;
  terminalUrl: string | null;
  sources: { projects: boolean; agents: boolean; deployments: boolean; usage: boolean };
};

const EMPTY: WorkspaceData = {
  projects: [], tasks: [], deployments: [], agents: 0, balance: null, plan: "Free",
  commands: 0, generations: 0, tasksCompleted: 0, daily: [], runtimeOnline: false,
  terminalUrl: null, sources: { projects: false, agents: false, deployments: false, usage: false },
};

const MODE_CONFIG: Record<CreationMode, { label: string; tool?: string; placeholder: string }> = {
  chat: { label: "Ask LiTT", placeholder: "Describe your idea, problem, or next task…" },
  builder: { label: "Build App", tool: "build", placeholder: "Describe the app or site you want to build…" },
  image: { label: "Create Image", tool: "image", placeholder: "Describe the image you want to create…" },
  project: { label: "Connect Project", placeholder: "What repository or project should we connect?" },
  agent: { label: "Run Agent", tool: "agents", placeholder: "Describe the mission for your agent…" },
};

async function readJson(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

function studioHref(mode: CreationMode, prompt: string) {
  const params = new URLSearchParams();
  const config = MODE_CONFIG[mode];
  if (config.tool) params.set("tool", config.tool);
  if (prompt.trim()) params.set("mission", prompt.trim());
  return `/studio${params.size ? `?${params.toString()}` : ""}`;
}

export default function DashboardContent() {
  const router = useRouter();
  const { resolvedColors: T } = useTheme();
  const { profile } = useProfile();
  const { user } = useAppUser();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<WorkspaceData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mode, setMode] = useState<CreationMode>("chat");
  const [prompt, setPrompt] = useState("");
  const [listening, setListening] = useState(false);

  const displayName = profile.displayName || user?.firstName || user?.username || "Member";

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      readJson("/api/projects"), readJson("/api/user-agents"), readJson("/api/agent-tasks"),
      readJson("/api/deployments?limit=25"), readJson("/api/wallet"), readJson("/api/usage/stats"),
      readJson("/api/terminal/token"),
    ]);
    const [projectsR, agentsR, tasksR, deploymentsR, walletR, usageR, terminalR] = results;
    const projects = projectsR.status === "fulfilled" ? projectsR.value.projects ?? [] : [];
    const tasks = tasksR.status === "fulfilled" ? tasksR.value.tasks ?? [] : [];
    const deployments = deploymentsR.status === "fulfilled" ? deploymentsR.value.deployments ?? [] : [];
    const agents = agentsR.status === "fulfilled" ? agentsR.value.agents ?? [] : [];
    const wallet = walletR.status === "fulfilled" ? walletR.value : null;
    const usage = usageR.status === "fulfilled" && !usageR.value.demo ? usageR.value : null;
    let runtimeOnline = false;
    let terminalUrl: string | null = null;
    if (terminalR.status === "fulfilled") {
      terminalUrl = terminalR.value.baseUrl ?? process.env.NEXT_PUBLIC_TERMINAL_URL ?? null;
      if (terminalUrl) {
        try {
          const health = await fetch(`${terminalUrl.replace(/\/$/, "")}/health`, { cache: "no-store" });
          runtimeOnline = health.ok;
        } catch { runtimeOnline = false; }
      }
    }
    setData({
      projects, tasks, deployments, agents: agents.length,
      balance: typeof wallet?.balance === "number" ? wallet.balance : null,
      plan: usage?.summary?.plan ?? wallet?.plan ?? "Free",
      commands: usage?.summary?.totalCommands ?? 0,
      generations: usage?.summary?.totalGenerations ?? 0,
      tasksCompleted: usage?.summary?.totalAgentTasks ?? 0,
      daily: usage?.daily ?? [], runtimeOnline, terminalUrl,
      sources: {
        projects: projectsR.status === "fulfilled", agents: agentsR.status === "fulfilled",
        deployments: deploymentsR.status === "fulfilled", usage: Boolean(usage),
      },
    });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = () => router.push(studioHref(mode, prompt));

  const uploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", body });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || "Upload failed");
      router.push(studioHref("chat", `Help me work with ${file.name}. File: ${result.url}`));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const startVoice = () => {
    type SpeechResult = { 0: { transcript: string } };
    type SpeechEvent = { results: ArrayLike<SpeechResult> };
    type SpeechRecognitionLike = { lang: string; interimResults: boolean; start: () => void; onresult: (event: SpeechEvent) => void; onend: () => void; onerror: () => void };
    type SpeechCtor = new () => SpeechRecognitionLike;
    const speechWindow = window as typeof window & { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) { router.push(studioHref("chat", "Start a voice conversation with LiTT")); return; }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => setPrompt(event.results[event.results.length - 1][0].transcript);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const activeTasks = data.tasks.filter((task) => !["completed", "failed", "cancelled"].includes(task.status ?? "")).slice(0, 3);
  const recentProjects = data.projects.slice(0, 3);
  const hasWork = recentProjects.length > 0 || activeTasks.length > 0 || data.generations > 0;
  const hasAnalytics = data.commands + data.generations + data.tasksCompleted + data.deployments.length > 0;
  const maxDay = useMemo(() => Math.max(1, ...data.daily.map((day) => day.commands + day.agentTasks + day.generations)), [data.daily]);

  const statuses = [
    { label: "GitHub", ok: data.projects.length > 0, detail: data.projects.length ? "Connected" : "Connect", href: "/projects", icon: GitBranch },
    { label: "Runtime", ok: data.runtimeOnline, detail: data.runtimeOnline ? "Online" : "Offline", href: "/settings?tab=cli", icon: Code2 },
    { label: "Deployments", ok: data.deployments.some((item) => item.status === "live"), detail: data.deployments.some((item) => item.status === "live") ? "Live" : "Setup", href: "/deployments", icon: Cloud },
    { label: "Workspace", ok: data.sources.projects && data.sources.agents, detail: data.sources.projects ? "Synced" : "Diagnose", href: "/settings?tab=workspace", icon: CheckCircle2 },
  ];

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 pb-10">
      <section className="relative overflow-hidden rounded-[28px] border border-violet-400/25 bg-[#090811] p-5 shadow-[0_30px_100px_rgba(0,0,0,.42)] sm:p-8 lg:p-10">
        <div className="pointer-events-none absolute -right-20 -top-40 h-96 w-96 rounded-full bg-violet-600/25 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-40 left-1/4 h-80 w-80 rounded-full bg-cyan-500/15 blur-[90px]" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-white/50">Welcome back, {displayName}</p>
              <h1 className="mt-2 text-3xl font-black tracking-[-.04em] text-white sm:text-5xl">What are we building today?</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/50">Start with an idea. LiTT will carry the context into Studio and assemble the right tools.</p>
            </div>
            <Link href="/wallet" className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white/70 backdrop-blur hover:bg-white/10">
              {data.balance === null ? data.plan : `${data.balance.toLocaleString()} LBC`} · {data.plan}
            </Link>
          </div>

          <div className="mt-7 rounded-2xl border border-white/12 bg-black/35 p-2 shadow-[0_18px_60px_rgba(0,0,0,.35)] backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="ml-2 shrink-0 text-violet-300" />
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }}
                placeholder={MODE_CONFIG[mode].placeholder}
                rows={1}
                className="min-h-12 flex-1 resize-none bg-transparent px-2 py-3 text-sm text-white outline-none placeholder:text-white/30 sm:text-base"
              />
              <button onClick={submit} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-500 text-white shadow-[0_0_28px_rgba(139,92,246,.38)] transition hover:scale-105" aria-label="Open in Studio">
                <ArrowRight size={19} />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(["builder", "image", "project", "agent"] as CreationMode[]).map((item) => (
              <button key={item} onClick={() => item === "project" ? router.push("/projects") : setMode(item)} className="rounded-full border px-3 py-2 text-[10px] font-bold transition hover:-translate-y-0.5" style={{ borderColor: mode === item ? `${T.accentColor}80` : "rgba(255,255,255,.1)", backgroundColor: mode === item ? `${T.accentColor}18` : "rgba(255,255,255,.035)", color: mode === item ? T.accentColor : "rgba(255,255,255,.58)" }}>
                {MODE_CONFIG[item].label}
              </button>
            ))}
            <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.035] px-3 py-2 text-[10px] font-bold text-white/60 hover:text-white disabled:opacity-50">
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload Files
            </button>
            <button onClick={startVoice} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.035] px-3 py-2 text-[10px] font-bold text-white/60 hover:text-white">
              <Mic size={12} className={listening ? "animate-pulse text-rose-400" : ""} /> {listening ? "Listening…" : "Voice"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,.75fr)]">
        <div className="rounded-[24px] border border-white/10 bg-[#0c0b13]/90 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Continue working</p><h2 className="mt-1 text-xl font-black text-white">Pick up where you left off</h2></div>
            <Link href="/projects" className="text-[10px] font-bold text-white/45 hover:text-white">View all <ArrowRight size={11} className="inline" /></Link>
          </div>

          {loading ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-white/5" /><div className="h-28 animate-pulse rounded-2xl bg-white/5" /></div>
          ) : hasWork ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {recentProjects.map((project) => (
                <Link key={project.id} href={`/studio?mission=${encodeURIComponent(`Continue work on ${project.owner ?? ""}/${project.repository ?? "project"}`)}`} className="group rounded-2xl border border-cyan-300/15 bg-cyan-300/[.045] p-4 transition hover:-translate-y-0.5 hover:border-cyan-300/35">
                  <div className="flex items-center gap-2 text-cyan-300"><FolderGit2 size={16} /><span className="text-[9px] font-black uppercase tracking-widest">Repository</span></div>
                  <div className="mt-4 truncate text-sm font-black text-white">{project.repository ?? "Untitled project"}</div>
                  <div className="mt-1 text-[10px] text-white/40">{project.owner ?? "Workspace"} · {project.status ?? "Ready"}</div>
                  <div className="mt-3 flex items-center gap-1 text-[10px] font-bold text-cyan-200 opacity-70 group-hover:opacity-100">Resume <Play size={10} /></div>
                </Link>
              ))}
              {activeTasks.map((task) => (
                <Link key={task.id} href={`/studio?mission=${encodeURIComponent(task.task_input?.prompt ?? "Resume my active agent mission")}`} className="group rounded-2xl border border-violet-300/15 bg-violet-300/[.045] p-4 transition hover:-translate-y-0.5 hover:border-violet-300/35">
                  <div className="flex items-center gap-2 text-violet-300"><Bot size={16} /><span className="text-[9px] font-black uppercase tracking-widest">Active mission</span></div>
                  <div className="mt-4 line-clamp-1 text-sm font-black text-white">{task.task_input?.prompt ?? "Agent mission"}</div>
                  <div className="mt-1 text-[10px] text-white/40">{task.assigned_to ?? "LiTT Agent"} · {task.status ?? "Queued"}</div>
                  <div className="mt-3 flex items-center gap-1 text-[10px] font-bold text-violet-200 opacity-70 group-hover:opacity-100">Open mission <ArrowRight size={10} /></div>
                </Link>
              ))}
              {data.generations > 0 && <Link href="/gallery" className="rounded-2xl border border-fuchsia-300/15 bg-fuchsia-300/[.045] p-4"><ImageIcon size={16} className="text-fuchsia-300" /><div className="mt-4 text-sm font-black text-white">Recent generations</div><div className="mt-1 text-[10px] text-white/40">{data.generations.toLocaleString()} assets in your workspace</div></Link>}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-violet-300/25 bg-violet-300/[.04] p-6 text-center sm:p-8">
              <Sparkles size={24} className="mx-auto text-violet-300" />
              <h3 className="mt-3 text-base font-black text-white">Your first build starts here</h3>
              <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-white/45">Describe an idea above, connect a GitHub repository, or let LiTT guide your workspace setup.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2"><button onClick={() => { setMode("builder"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="rounded-xl bg-violet-500 px-4 py-2 text-xs font-black text-white">Build something</button><Link href="/projects" className="rounded-xl border border-white/10 px-4 py-2 text-xs font-black text-white/65">Connect GitHub</Link></div>
            </div>
          )}
        </div>

        <aside className="relative overflow-hidden rounded-[24px] border border-violet-300/20 bg-[linear-gradient(145deg,#151027,#0a0b12_70%)] p-5 sm:p-6">
          <div className="absolute -right-20 -top-20 h-48 w-48 rounded-full bg-violet-500/20 blur-[70px]" />
          <div className="relative flex items-center gap-3"><LiTTMessageAvatar size={42} /><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-300">LiTT Assistant</p><h2 className="text-lg font-black text-white">LiTT is ready</h2></div></div>
          <p className="relative mt-5 text-sm leading-6 text-white/65">
            {!data.projects.length ? "Connect GitHub so I can understand your code and help you continue real projects." : !data.runtimeOnline ? "Your GitHub workspace is connected, but the agent runtime still needs setup." : "Your workspace and runtime are connected. Tell me what you want to ship next."}
          </p>
          <div className="relative mt-5 space-y-2">
            {!data.projects.length && <Link href="/projects" className="flex items-center justify-between rounded-xl border border-cyan-300/20 bg-cyan-300/[.06] px-3 py-2.5 text-xs font-bold text-cyan-200"><span className="flex items-center gap-2"><GitBranch size={13} />Connect GitHub</span><ArrowRight size={12} /></Link>}
            {data.projects.length > 0 && <Link href="/studio?mission=Scan%20my%20GitHub%20project%20and%20summarize%20what%20needs%20attention" className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[.035] px-3 py-2.5 text-xs font-bold text-white/65"><span className="flex items-center gap-2"><RefreshCw size={13} />Scan GitHub</span><ArrowRight size={12} /></Link>}
            {!data.runtimeOnline && <Link href="/settings?tab=cli" className="flex items-center justify-between rounded-xl border border-amber-300/20 bg-amber-300/[.06] px-3 py-2.5 text-xs font-bold text-amber-200"><span className="flex items-center gap-2"><Wrench size={13} />Finish runtime setup</span><ArrowRight size={12} /></Link>}
            {data.runtimeOnline && <Link href="/studio?tool=terminal&mission=cline%20--acp" className="flex items-center justify-between rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] px-3 py-2.5 text-xs font-bold text-emerald-200"><span className="flex items-center gap-2"><Code2 size={13} />Start Cline</span><ArrowRight size={12} /></Link>}
            <Link href="/settings?tab=workspace" className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[.035] px-3 py-2.5 text-xs font-bold text-white/65"><span className="flex items-center gap-2"><Wrench size={13} />Diagnose connections</span><ArrowRight size={12} /></Link>
          </div>
          <button onClick={() => router.push(studioHref("chat", "Help me decide what to work on next"))} className="relative mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-3 text-xs font-black text-white shadow-[0_12px_35px_rgba(139,92,246,.25)]"><Send size={13} />Ask LiTT</button>
        </aside>
      </section>

      <section className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-4">
        {statuses.map((status) => (
          <Link key={status.label} href={status.href} className="flex items-center gap-3 bg-[#0c0b13] px-4 py-3 transition hover:bg-white/[.055]">
            <status.icon size={15} className={status.ok ? "text-emerald-400" : "text-amber-300"} />
            <div className="min-w-0 flex-1"><div className="text-[10px] font-black text-white/75">{status.label}</div><div className={`text-[9px] ${status.ok ? "text-emerald-400/70" : "text-amber-300/70"}`}>{status.detail}</div></div>
            <ArrowRight size={11} className="text-white/20" />
          </Link>
        ))}
      </section>

      {hasAnalytics && (
        <section className="rounded-[24px] border border-white/8 bg-[#0b0a11]/75 p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-white/35">Usage & performance</p><h2 className="mt-1 text-lg font-black text-white">Workspace analytics</h2></div><button onClick={() => void refresh()} disabled={refreshing} className="rounded-xl border border-white/10 p-2 text-white/40 hover:text-white"><RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /></button></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[{ label: "Balance", value: data.balance === null ? data.plan : `${data.balance.toLocaleString()} LBC`, icon: Wallet }, { label: "Commands", value: data.commands.toLocaleString(), icon: Code2 }, { label: "Generations", value: data.generations.toLocaleString(), icon: ImageIcon }, { label: "Deployments", value: data.deployments.length.toLocaleString(), icon: Rocket }].filter((item) => item.label === "Balance" || item.value !== "0").map((item) => <div key={item.label} className="rounded-2xl border border-white/8 bg-white/[.025] p-4"><item.icon size={14} className="text-violet-300" /><div className="mt-3 text-xl font-black text-white">{item.value}</div><div className="mt-1 text-[9px] uppercase tracking-wider text-white/35">{item.label}</div></div>)}
          </div>
          {data.daily.length > 0 && <div className="mt-5 rounded-2xl border border-white/8 bg-black/20 p-4"><div className="flex items-center gap-2 text-xs font-black text-white/60"><Activity size={14} />Seven-day activity</div><div className="mt-5 flex h-28 items-end gap-2">{data.daily.slice(-7).map((day) => { const total = day.commands + day.agentTasks + day.generations; return <div key={day.date} className="flex h-full flex-1 flex-col justify-end gap-2"><div className="min-h-1 rounded-t-md" style={{ height: `${Math.max(4, (total / maxDay) * 100)}%`, background: "linear-gradient(180deg,#8b5cf6,#22d3ee)" }} /><span className="text-center text-[8px] text-white/25">{new Date(`${day.date}T12:00:00`).toLocaleDateString([], { weekday: "narrow" })}</span></div>; })}</div></div>}
        </section>
      )}
    </div>
  );
}
