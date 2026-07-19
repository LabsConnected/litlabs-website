"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  Bot,
  CircleAlert,
  Code2,
  FileCode2,
  FolderOpen,
  Image as ImageIcon,
  Monitor,
  ScreenShare,
  Terminal,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-xs text-white/40">Loading editor…</div>,
});

export type StudioWorkspaceMode = "code" | "media" | "command";

type Props = {
  mode: StudioWorkspaceMode;
  onModeChangeAction: (mode: StudioWorkspaceMode) => void;
  activeProjectId: string | null;
  onOpenProjectsAction: () => void;
  onOpenTerminalAction: () => void;
  conversation: ReactNode;
};

const STORAGE_KEY = "litt-studio-hybrid-layout";

function StateBadge({ state, label }: { state: "demo" | "unavailable" | "connected"; label: string }) {
  const color = state === "connected" ? "text-emerald-300 border-emerald-400/25 bg-emerald-400/10" : state === "demo" ? "text-amber-200 border-amber-300/20 bg-amber-300/10" : "text-white/45 border-white/10 bg-white/5";
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${color}`}>{label}</span>;
}

function EmptyPanel({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#080c19]/65 p-6 text-center backdrop-blur-xl">
      <CircleAlert size={20} className="mb-3 text-cyan-300" />
      <h2 className="text-sm font-bold text-white">{title}</h2>
      <p className="mt-1 max-w-sm text-xs leading-5 text-white/45">{detail}</p>
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}

export default function StudioHybridWorkspace({ mode, onModeChangeAction, activeProjectId, onOpenProjectsAction, onOpenTerminalAction, conversation }: Props) {
  const [draft, setDraft] = useState("// Demo draft — connect a project to edit real files.\nexport const studioMode = \"code\";\n");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { explorerOpen?: boolean; activityOpen?: boolean; previewDevice?: typeof previewDevice };
      if (typeof saved.explorerOpen === "boolean") setExplorerOpen(saved.explorerOpen);
      if (typeof saved.activityOpen === "boolean") setActivityOpen(saved.activityOpen);
      if (saved.previewDevice === "desktop" || saved.previewDevice === "tablet" || saved.previewDevice === "mobile") setPreviewDevice(saved.previewDevice);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ explorerOpen, activityOpen, previewDevice }));
  }, [explorerOpen, activityOpen, previewDevice]);

  const projectLabel = activeProjectId ? `Project ${activeProjectId.slice(0, 10)}` : "No project selected";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-2 pt-2 sm:px-5">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#050a18]/70 px-3 py-2.5 shadow-[0_16px_50px_rgba(0,0,0,.18)] backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200"><Code2 size={16} /></span>
          <div className="min-w-0"><p className="truncate text-sm font-black text-white">LiTT Builder</p><p className="truncate text-[10px] text-white/45">{projectLabel}</p></div>
          <button onClick={onOpenProjectsAction} className="ml-1 flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/65 hover:bg-white/10" title="Select project"><FolderOpen size={12} /> Projects</button>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black/20 p-1" aria-label="Studio workspace mode">
          {([ ["code", Code2, "Code"], ["media", Video, "Media"], ["command", Workflow, "Command"] ] as const).map(([value, Icon, label]) => (
            <button key={value} onClick={() => onModeChangeAction(value)} aria-pressed={mode === value} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${mode === value ? "bg-violet-500/25 text-white shadow-[0_0_18px_rgba(139,92,246,.2)]" : "text-white/45 hover:bg-white/5 hover:text-white"}`}><Icon size={13} />{label}</button>
          ))}
        </div>
        <div className="hidden items-center gap-1.5 lg:flex"><StateBadge state={activeProjectId ? "connected" : "unavailable"} label={activeProjectId ? "Project selected" : "Not connected"} /><StateBadge state="unavailable" label="Git unavailable" /></div>
      </header>

      {mode === "code" && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(190px,.55fr)_minmax(0,1.6fr)_minmax(220px,.65fr)]">
          {explorerOpen && <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#070c19]/70 backdrop-blur-xl lg:flex"><div className="flex items-center justify-between border-b border-white/10 px-3 py-2"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-white/55">Explorer</span><button onClick={() => setExplorerOpen(false)} className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Collapse explorer"><X size={13} /></button></div><div className="flex flex-1 flex-col items-center justify-center px-4 text-center"><FolderOpen size={18} className="mb-2 text-cyan-300"/><p className="text-xs font-semibold text-white/75">Project files unavailable</p><p className="mt-1 text-[11px] leading-4 text-white/40">Connect a project to inspect files through the authenticated workspace.</p><button onClick={onOpenProjectsAction} className="mt-3 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1.5 text-[10px] font-bold text-cyan-100">Select project</button></div></aside>}
          <section className="grid min-h-0 grid-rows-[minmax(260px,1fr)_minmax(180px,.7fr)] gap-3">
            <div className="min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-[#070c19]/75 shadow-[0_16px_50px_rgba(0,0,0,.14)] backdrop-blur-xl"><div className="flex items-center justify-between border-b border-white/10 px-3 py-2"><div className="flex items-center gap-2"><FileCode2 size={14} className="text-violet-200"/><span className="text-xs font-semibold text-white/85">workspace-draft.ts</span><StateBadge state="demo" label="Demo draft" /></div><span className="text-[10px] text-white/35">Saving unavailable</span></div><div className="h-[calc(100%-37px)]"><MonacoEditor height="100%" language="typescript" value={draft} theme="vs-dark" onChange={(value) => setDraft(value ?? "")} options={{ minimap: { enabled: false }, automaticLayout: true, fontSize: 13, scrollBeyondLastLine: false, readOnly: false }} /></div></div>
            <div className="min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-[#070c19]/75 backdrop-blur-xl"><div className="flex items-center justify-between border-b border-white/10 px-3 py-2"><div className="flex items-center gap-2"><ScreenShare size={14} className="text-cyan-200"/><span className="text-xs font-semibold text-white/85">Live preview</span><StateBadge state="unavailable" label="Unavailable" /></div><div className="flex gap-1">{(["desktop", "tablet", "mobile"] as const).map((device) => <button key={device} onClick={() => setPreviewDevice(device)} className={`rounded px-1.5 py-1 text-[9px] capitalize ${previewDevice === device ? "bg-white/10 text-white" : "text-white/35 hover:text-white"}`}>{device}</button>)}</div></div><div className="grid h-[calc(100%-37px)] place-items-center px-5 text-center"><div><Monitor size={20} className="mx-auto mb-2 text-white/30"/><p className="text-xs font-semibold text-white/70">Preview unavailable</p><p className="mt-1 text-[11px] text-white/40">Start a project-backed preview to use the {previewDevice} viewport.</p></div></div></div>
          </section>
          {activityOpen && <aside className="hidden min-h-0 flex-col gap-3 overflow-hidden lg:flex"><section className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-[#070c19]/70 p-3 backdrop-blur-xl"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-white/55">Agent activity</span><button onClick={() => setActivityOpen(false)} className="rounded p-1 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Collapse agent activity"><X size={13} /></button></div><div className="mt-8 text-center"><Bot size={18} className="mx-auto mb-2 text-violet-200"/><p className="text-xs text-white/65">No active agents</p><p className="mt-1 text-[11px] leading-4 text-white/35">Agent missions appear here when a verified project task is running.</p></div></section><section className="rounded-2xl border border-white/10 bg-[#070c19]/70 p-3 backdrop-blur-xl"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-white/55">Changes</span><p className="mt-3 text-xs text-white/55">Git review unavailable</p><p className="mt-1 text-[11px] text-white/35">Approve, reject, and undo appear with a verified diff.</p></section></aside>}
          <button onClick={onOpenTerminalAction} className="fixed bottom-28 right-4 z-30 flex items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-bold text-emerald-100 shadow-lg lg:hidden"><Terminal size={15} /> Terminal</button>
        </div>
      )}

      {mode === "media" && <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(240px,.6fr)]"><section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-2xl border border-white/10 bg-[#070c19]/70 p-4 backdrop-blur-xl"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold text-white">Media pipeline</p><p className="text-xs text-white/40">Image, video, audio, and artifact workflows.</p></div><StateBadge state="unavailable" label="No active job" /></div><div className="mt-4 grid min-h-0 place-items-center rounded-xl border border-dashed border-white/10 bg-black/20 text-center"><div><ImageIcon size={22} className="mx-auto mb-2 text-cyan-200"/><p className="text-sm font-semibold text-white/75">No render queue</p><p className="mt-1 max-w-sm text-xs leading-5 text-white/40">Generation stages, preview, retry, cancel, downloads, errors, and usage appear only after a provider job is created.</p></div></div></section><aside className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><EmptyPanel title="Artifacts empty" detail="Generated artifacts will be shown with source, status, and download actions."/><EmptyPanel title="Usage unavailable" detail="Provider cost and capacity are not available for this workspace."/></aside></div>}

      {mode === "command" && <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]"><section className="min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-[#070c19]/70 backdrop-blur-xl"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div><p className="text-sm font-bold text-white">Mission command center</p><p className="text-xs text-white/40">Projects, missions, connections, and system health.</p></div><StateBadge state="unavailable" label="No mission" /></div><div className="min-h-0 overflow-y-auto p-3">{conversation}</div></section><aside className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1"><EmptyPanel title="No connected services" detail="GitHub, preview, deployments, and provider health will report verified state here." action={<button onClick={onOpenProjectsAction} className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold text-cyan-100">Open projects</button>}/><EmptyPanel title="System activity empty" detail="Live agent and system events appear only when recorded by an authenticated backend."/></aside></div>}

      <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-[#050a18]/60 px-3 py-2 text-[10px] text-white/40 backdrop-blur-xl"><span className="flex items-center gap-1.5"><Activity size={12} /> Workspace state is feature-flagged</span><button onClick={onOpenTerminalAction} className="flex items-center gap-1.5 text-cyan-200 hover:text-cyan-100"><Terminal size={12} /> Open authenticated terminal</button></div>
    </section>
  );
}
