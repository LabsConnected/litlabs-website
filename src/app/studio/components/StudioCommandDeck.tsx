"use client";

import dynamic from "next/dynamic";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import {
  Activity,
  Bell,
  Bot,
  Braces,
  ChevronDown,
  CircleAlert,
  Cloud,
  Code2,
  FileCode2,
  FolderOpen,
  GitBranch,
  Maximize2,
  Monitor,
  Play,
  Settings,
  Sparkles,
  Terminal,
  Users,
  Video,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./studio-command-deck.module.css";

loader.config({ monaco });

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export type StudioCommandDeckMode = "code" | "media" | "command";

type DeckProps = {
  mode: StudioCommandDeckMode;
  onModeChangeAction: (mode: StudioCommandDeckMode) => void;
  activeProjectId: string | null;
  onOpenProjectsAction: () => void;
  onOpenTerminalAction: () => void;
  conversation: ReactNode;
};

type RailItem = { id: StudioCommandDeckMode | "files" | "agents" | "terminal" | "settings"; label: string; icon: LucideIcon };

const RAIL: RailItem[] = [
  { id: "code", label: "Code", icon: Code2 },
  { id: "media", label: "Media", icon: Video },
  { id: "command", label: "Command", icon: Workflow },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "settings", label: "Settings", icon: Settings },
];

const LAYOUT_KEY = "litt-command-deck-layout";

type PanelId = "explorer" | "preview" | "review" | "terminal";
type LayoutState = {
  version: 2;
  previewDevice: "desktop" | "tablet" | "mobile";
  rightTab: "activity" | "agents" | "git";
  collapsed: Record<PanelId, boolean>;
  sizes: Record<PanelId, number>;
};

const LIMITS: Record<PanelId, readonly [number, number]> = {
  explorer: [220, 360],
  preview: [320, 520],
  review: [280, 420],
  terminal: [180, 420],
};

const DEFAULT_LAYOUT: LayoutState = {
  version: 2,
  previewDevice: "desktop",
  rightTab: "activity",
  collapsed: { explorer: false, preview: false, review: false, terminal: false },
  sizes: { explorer: 260, preview: 380, review: 320, terminal: 260 },
};

function clampPanelSize(panel: PanelId, value: unknown): number {
  const [minimum, maximum] = LIMITS[panel];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : DEFAULT_LAYOUT.sizes[panel];
}

function Panel({ title, icon: Icon, children, className = "", action, panelId, collapsed, onCollapseAction, style }: { title: string; icon: LucideIcon; children: ReactNode; className?: string; action?: ReactNode; panelId?: PanelId; collapsed?: boolean; onCollapseAction?: () => void; style?: CSSProperties }) {
  return <section className={`${styles.panel} ${className} ${collapsed ? styles.collapsed : ""}`} style={style} data-deck-panel={panelId}><header className={styles.panelHeader}><span className={styles.panelTitle}><Icon size={13} /> {title}</span><div className={styles.panelActions}>{action}{onCollapseAction && <button onClick={onCollapseAction} aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`} title={`${collapsed ? "Expand" : "Collapse"} panel`}>{collapsed ? "+" : "−"}</button>}</div></header>{!collapsed && children}</section>;
}

function TerminalStrip({ collapsed, onCollapseAction, onOpenTerminalAction, style }: { collapsed: boolean; onCollapseAction: () => void; onOpenTerminalAction: () => void; style?: CSSProperties }) {
  return <div className={`${styles.terminalStrip} ${collapsed ? styles.terminalCollapsed : ""}`} style={style} data-deck-panel="terminal"><div className={styles.terminalTabs}><button>Terminal</button><button>Problems</button><button>Output</button><button>Tests</button></div><div className="flex gap-1"><button className={styles.iconButton} onClick={onCollapseAction} aria-label={`${collapsed ? "Expand" : "Collapse"} terminal`} title={`${collapsed ? "Expand" : "Collapse"} terminal`}>{collapsed ? "+" : "−"}</button><button className={styles.button} onClick={onOpenTerminalAction}><Terminal size={12} /> Open terminal</button></div></div>;
}

function Splitter({ panel, size, vertical = false, invert = false, style, onResizeAction }: { panel: PanelId; size: number; vertical?: boolean; invert?: boolean; style?: CSSProperties; onResizeAction: (panel: PanelId, nextSize: number) => void }) {
  return <div className={`${styles.splitter} ${vertical ? styles.splitterVertical : ""}`} style={style} role="separator" aria-orientation={vertical ? "horizontal" : "vertical"} aria-label={`Resize ${panel} panel`} tabIndex={0} onPointerDown={(event) => {
    const start = vertical ? event.clientY : event.clientX;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => { const delta = vertical ? next.clientY - start : next.clientX - start; onResizeAction(panel, invert ? size - delta : size + delta); };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }} onKeyDown={(event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") onResizeAction(panel, size + (invert ? 20 : -20));
    if (event.key === "ArrowRight" || event.key === "ArrowDown") onResizeAction(panel, size + (invert ? -20 : 20));
  }} />;
}

function EmptyState({ title, description, actionLabel, onAction, secondaryLabel }: { title: string; description: string; actionLabel?: string; onAction?: () => void; secondaryLabel?: string }) {
  return <div className={styles.empty}><div className={styles.emptyCard}><CircleAlert size={18} className="mx-auto mb-2 text-cyan-200" /><h3>{title}</h3><p>{description}</p>{actionLabel && onAction && <div className={styles.emptyActions}><button className={styles.button} onClick={onAction}>{actionLabel}</button>{secondaryLabel && <button className={`${styles.button} ${styles.buttonSecondary}`} disabled>{secondaryLabel}</button>}</div>}</div></div>;
}

export default function StudioCommandDeck({ mode, onModeChangeAction, activeProjectId, onOpenProjectsAction, onOpenTerminalAction, conversation }: DeckProps) {
  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT);
  const [draft, setDraft] = useState("// Demo draft — connect a project to edit real files.\nexport const studioMode = \"code\";\n");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Partial<LayoutState>;
      if (saved.version === 2) {
        setLayout({
          ...DEFAULT_LAYOUT,
          ...saved,
          collapsed: { ...DEFAULT_LAYOUT.collapsed, ...saved.collapsed },
          sizes: {
            explorer: clampPanelSize("explorer", saved.sizes?.explorer),
            preview: clampPanelSize("preview", saved.sizes?.preview),
            review: clampPanelSize("review", saved.sizes?.review),
            terminal: clampPanelSize("terminal", saved.sizes?.terminal),
          },
        });
      }
    } catch {}
  }, []);
  useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }, [layout]);
  useEffect(() => { localStorage.setItem("litt-command-deck-mode", mode); }, [mode]);

  const setCollapsed = (panel: PanelId) => setLayout((current) => ({ ...current, collapsed: { ...current.collapsed, [panel]: !current.collapsed[panel] } }));
  const setPanelSize = (panel: PanelId, size: number) => { const [min, max] = LIMITS[panel]; const clamped = Math.min(max, Math.max(min, Math.round(size))); setLayout((current) => current.sizes[panel] === clamped ? current : ({ ...current, sizes: { ...current.sizes, [panel]: clamped } })); };
  const resetLayout = () => setLayout(DEFAULT_LAYOUT);

  const selectRail = (id: RailItem["id"]) => {
    if (id === "code" || id === "media" || id === "command") onModeChangeAction(id);
    if (id === "files") onOpenProjectsAction();
    if (id === "terminal") onOpenTerminalAction();
  };
  const projectLabel = activeProjectId ? `Project ${activeProjectId.slice(0, 8)}` : "No project";
  const explorerW = layout.collapsed.explorer ? 42 : layout.sizes.explorer;
  const reviewW = layout.collapsed.review ? 42 : layout.sizes.review;
  const previewH = layout.collapsed.preview ? 42 : layout.sizes.preview;
  const terminalH = layout.collapsed.terminal ? 42 : layout.sizes.terminal;
  const codeGridStyle: CSSProperties = { gridTemplateColumns: `${explorerW}px ${layout.collapsed.explorer ? 0 : 6}px minmax(0,1fr) ${layout.collapsed.review ? 0 : 6}px ${reviewW}px`, gridTemplateRows: `minmax(0,1fr) ${layout.collapsed.terminal ? 0 : 6}px ${terminalH}px` };
  const stackGridStyle: CSSProperties = { gridTemplateRows: `minmax(0,1fr) ${layout.collapsed.preview ? 0 : 6}px ${previewH}px` };

  return <section className={styles.deck}>
    <aside className={styles.rail} aria-label="Studio tools">{RAIL.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => selectRail(id)} data-label={label} data-active={id === mode} aria-label={label} title={label}><Icon size={18} /></button>)}</aside>
    <div className={styles.workspace}>
      <header className={styles.commandBar}>
        <div className={styles.brand}><span className={styles.brandMark}><Sparkles size={15} /></span><span>LiTT</span></div>
        <div className={styles.modules}>
          <button className={styles.module} onClick={onOpenProjectsAction}><FolderOpen size={12} /><strong>{projectLabel}</strong><ChevronDown size={11} /></button>
          <span className={styles.module}><GitBranch size={12} /><strong>{activeProjectId ? "Branch unavailable" : "No branch"}</strong></span>
          <span className={styles.module}><Monitor size={12} />Preview <strong>Unavailable</strong></span>
          <span className={styles.module}><Cloud size={12} />Services <strong>Not connected</strong></span>
          <span className={styles.module}><Sparkles size={12} />Credits <strong>Unavailable</strong></span>
        </div>
        <div className={styles.actions}><button className={styles.iconButton} onClick={resetLayout} aria-label="Reset Studio layout" title="Reset layout">↺</button><button className={styles.iconButton} aria-label="Notifications" title="Notifications"><Bell size={14} /></button><button className={styles.iconButton} aria-label="Profile" title="Profile"><Users size={14} /></button></div>
      </header>

      {mode === "code" && <div className={`${styles.main} ${styles.codeMain}`} style={codeGridStyle}>
        <Panel title="Explorer" icon={FolderOpen} panelId="explorer" collapsed={layout.collapsed.explorer} onCollapseAction={() => setCollapsed("explorer")} style={{ gridColumn: 1, gridRow: 1 }} className={styles.explorerPanel} action={<button onClick={onOpenProjectsAction} aria-label="Select project"><FolderOpen size={13} /></button>}>
          {activeProjectId ? <div className={styles.fileTree}><div className={styles.fileRow}><FileCode2 size={13} /> File index loading is unavailable</div></div> : <EmptyState title="No project selected" description="Choose a connected project to load files, preview, and Git status." actionLabel="Select project" onAction={onOpenProjectsAction} secondaryLabel="Connect GitHub" />}
        </Panel>
        {!layout.collapsed.explorer && <Splitter panel="explorer" size={layout.sizes.explorer} onResizeAction={setPanelSize} style={{ gridColumn: 2, gridRow: 1 }} />}
        <div className={styles.stack} style={{ gridColumn: 3, gridRow: 1, ...stackGridStyle }}>
          <Panel title="Editor" icon={Braces} style={{ gridRow: 1 }} action={<><button aria-label="Unsaved demo draft"><span className="text-[9px]">Demo</span></button><button aria-label="Maximize editor"><Maximize2 size={13} /></button></>}><div className={styles.editor}><MonacoEditor height="100%" language="typescript" value={draft} theme="vs-dark" onChange={(value) => setDraft(value ?? "")} options={{ automaticLayout: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }} /></div></Panel>
          {!layout.collapsed.preview && <Splitter panel="preview" size={layout.sizes.preview} vertical invert onResizeAction={setPanelSize} style={{ gridRow: 2 }} />}
          <Panel title="Live preview" icon={Monitor} panelId="preview" collapsed={layout.collapsed.preview} onCollapseAction={() => setCollapsed("preview")} style={{ gridRow: 3 }} action={<div className={styles.tabs}>{(["desktop", "tablet", "mobile"] as const).map((device) => <button key={device} data-active={layout.previewDevice === device} onClick={() => setLayout((current) => ({ ...current, previewDevice: device }))}>{device}</button>)}</div>}><div className={styles.previewCanvas}><EmptyState title="Preview unavailable" description={`A project runtime has not been provisioned for ${layout.previewDevice} preview.`} actionLabel="View requirements" onAction={() => undefined} /></div></Panel>
        </div>
        {!layout.collapsed.review && <Splitter panel="review" size={layout.sizes.review} invert onResizeAction={setPanelSize} style={{ gridColumn: 4, gridRow: 1 }} />}
        <Panel title="Review" icon={GitBranch} panelId="review" collapsed={layout.collapsed.review} onCollapseAction={() => setCollapsed("review")} style={{ gridColumn: 5, gridRow: 1 }} className={styles.rightPanel}><div className={styles.rightTabs}>{(["activity", "agents", "git"] as const).map((tab) => <button key={tab} data-active={layout.rightTab === tab} onClick={() => setLayout((current) => ({ ...current, rightTab: tab }))}>{tab}</button>)}</div>{layout.rightTab === "activity" && <div className={styles.activity}><div className={styles.activityItem}><Activity size={13} /> No verified project activity.</div></div>}{layout.rightTab === "agents" && <EmptyState title="No active agents" description="Agent events appear when a verified project task runs." />}{layout.rightTab === "git" && <EmptyState title="Git unavailable" description="Changed files, exact diffs, approval, reject, and undo appear after Git workspace provisioning." />}</Panel>
        {!layout.collapsed.terminal && <Splitter panel="terminal" size={layout.sizes.terminal} vertical invert onResizeAction={setPanelSize} style={{ gridColumn: "1 / -1", gridRow: 2 }} />}
        <TerminalStrip collapsed={layout.collapsed.terminal} onCollapseAction={() => setCollapsed("terminal")} onOpenTerminalAction={onOpenTerminalAction} style={{ gridColumn: "1 / -1", gridRow: 3 }} />
      </div>}

      {mode === "media" && <div className={`${styles.main} ${styles.modeMain}`}><Panel title="Media pipeline" icon={Video}><div className={styles.modeHero}><div><h2>Generate, render, and organize.</h2><p>Image, video, audio, and assets share the selected project context.</p></div><div className={styles.timeline}><article><span>Stage 01</span><strong>Prompt & planning</strong><p>Unavailable</p></article><article><span>Stage 02</span><strong>Render queue</strong><p>No active jobs</p></article><article><span>Stage 03</span><strong>Artifacts</strong><p>Empty</p></article></div></div></Panel><aside className={styles.modeSidebar}><Panel title="Preview" icon={Play}><EmptyState title="Render preview unavailable" description="Start a provider-backed job to view progress and output." /></Panel><Panel title="Usage" icon={Activity}><EmptyState title="Provider usage unavailable" description="Usage and cost appear from a connected provider." /></Panel></aside><div className={styles.terminalStrip}><div className={styles.terminalTabs}><button>Terminal</button><button>Output</button></div><button className={styles.button} onClick={onOpenTerminalAction}>Open terminal</button></div></div>}

      {mode === "command" && <div className={`${styles.main} ${styles.modeMain}`}><Panel title="Mission command center" icon={Workflow}><div className={styles.modeHero}><div><h2>Project control, without invented status.</h2><p>Mission, service, agent, deployment, and system events appear from authenticated backend state.</p></div><div className={styles.timeline}><article><span>Projects</span><strong>{projectLabel}</strong><p>{activeProjectId ? "Selected" : "Not connected"}</p></article><article><span>Services</span><strong>Unavailable</strong><p>No verified health feed</p></article><article><span>Deployments</span><strong>Unavailable</strong><p>No project deployment</p></article></div></div></Panel><aside className={styles.modeSidebar}><Panel title="Conversation" icon={Bot}>{conversation}</Panel><Panel title="System activity" icon={Activity}><EmptyState title="Activity empty" description="Audit events will appear here when the project workspace is connected." /></Panel></aside><div className={styles.terminalStrip}><div className={styles.terminalTabs}><button>Terminal</button><button>Output</button></div><button className={styles.button} onClick={onOpenTerminalAction}>Open terminal</button></div></div>}
      <nav className={styles.bottomNav} aria-label="Studio tools">{RAIL.slice(0, 6).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => selectRail(id)} data-active={id === mode}><Icon size={16} /><span>{label}</span></button>)}</nav>
    </div>
  </section>;
}
