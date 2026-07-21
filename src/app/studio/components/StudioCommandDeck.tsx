"use client";

import dynamic from "next/dynamic";
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
import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./studio-command-deck.module.css";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Monaco is isolated in StudioMonacoEditor so Media/Command modes don't pay its bundle cost
const StudioMonacoEditor = dynamic(() => import("./StudioMonacoEditor"), { ssr: false });

// Dev-only: detect duplicate deck mounts (must run at module scope for the component root)
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const w = window as typeof window & Record<string, number>;
  // will be incremented in the component effect below
}

export type StudioCommandDeckMode = "code" | "media" | "command";

type DeckProps = {
  mode: StudioCommandDeckMode;
  onModeChangeAction: (mode: StudioCommandDeckMode) => void;
  activeProjectId: string | null;
  onOpenProjectsAction: () => void;
  conversation: ReactNode;
  terminal: ReactNode;
  // Controlled mobile surface (chat | build | files | preview | terminal).
  // The parent (LITTTerminalShell) owns the single source of truth.
  mobileView?: "chat" | "build" | "files" | "preview" | "terminal";
  onMobileViewChange?: (view: "chat" | "build" | "files" | "preview" | "terminal") => void;
  onMobileTerminalFocusChange?: (focused: boolean) => void;
  onActiveWindowChange?: (id: string | null) => void;
  onActiveFileChange?: (path: string | null) => void;
  onSelectedAssetChange?: (path: string | null) => void;
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

function Panel({ title, icon: Icon, children, className = "", action, panelId, collapsed, onCollapseAction, style, dataMobileId }: { title: string; icon: LucideIcon; children: ReactNode; className?: string; action?: ReactNode; panelId?: PanelId; collapsed?: boolean; onCollapseAction?: () => void; style?: CSSProperties; dataMobileId?: string }) {
  const sectionId = panelId ? `deck-panel-${panelId}` : undefined;
  return <section id={sectionId} className={`${styles.panel} ${className} ${collapsed ? styles.collapsed : ""}`} style={style} data-deck-panel={panelId} data-mobile-id={dataMobileId}><header className={styles.panelHeader}><span className={styles.panelTitle}><Icon size={13} /> {title}</span><div className={styles.panelActions}>{action}{onCollapseAction && <button onClick={onCollapseAction} aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`} title={`${collapsed ? "Expand" : "Collapse"} panel`} style={{ minWidth: 24, minHeight: 24, padding: 4 }}>{collapsed ? "+" : "−"}</button>}</div></header>{!collapsed && children}</section>;
}

function DockedTerminal({
  terminal,
  collapsed,
  onCollapseAction,
}: {
  terminal: ReactNode;
  collapsed: boolean;
  onCollapseAction: () => void;
}) {
  return (
    <section
      className={`${styles.dockedTerminal} ${collapsed ? styles.dockedTerminalCollapsed : ""}`}
    >
      <header className={styles.dockedTerminalHeader}>
        <div className={styles.terminalTabs}>
          <button data-active="true">Terminal</button>
          <button>Problems</button>
          <button>Output</button>
          <button>Tests</button>
        </div>

        <button
          type="button"
          className={styles.iconButton}
          onClick={onCollapseAction}
          aria-label={collapsed ? "Expand terminal" : "Collapse terminal"}
          style={{ minWidth: 24, minHeight: 24, padding: 4 }}
        >
          {collapsed ? "+" : "−"}
        </button>
      </header>

      {/* Always mount the terminal so PTY/cwd/history/dev server survive collapse. */}
      <div
        className={styles.dockedTerminalBody}
        hidden={collapsed}
        style={collapsed ? { visibility: "hidden", pointerEvents: "none", height: 0, minHeight: 0, overflow: "hidden" } : undefined}
      >
        {terminal}
      </div>
    </section>
  );
}

function Splitter({ panel, size, vertical = false, invert = false, style, onResizeAction }: { panel: PanelId; size: number; vertical?: boolean; invert?: boolean; style?: CSSProperties; onResizeAction: (panel: PanelId, nextSize: number) => void }) {
  const val = Math.max(0, Math.min(1000, Math.round(size || 0)));
  const controlsId = `deck-panel-${panel}`;
  return <div
    className={`${styles.splitter} ${vertical ? styles.splitterVertical : ""}`}
    style={style}
    role="separator"
    aria-orientation={vertical ? "horizontal" : "vertical"}
    aria-label={`Resize ${panel} panel`}
    aria-controls={controlsId}
    aria-valuemin={0}
    aria-valuemax={1000}
    aria-valuenow={val}
    aria-valuetext={`${val}px`}
    tabIndex={0}
    onPointerDown={(event) => {
      const start = vertical ? event.clientY : event.clientX;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent) => { const delta = vertical ? next.clientY - start : next.clientX - start; onResizeAction(panel, invert ? size - delta : size + delta); };
      const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
    }}
    onKeyDown={(event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") onResizeAction(panel, size + (invert ? 20 : -20));
      if (event.key === "ArrowRight" || event.key === "ArrowDown") onResizeAction(panel, size + (invert ? -20 : 20));
    }}
  />;
}

function EmptyState({ title, description, actionLabel, onAction, secondaryLabel }: { title: string; description: string; actionLabel?: string; onAction?: () => void; secondaryLabel?: string }) {
  return <div className={styles.empty}><div className={styles.emptyCard}><CircleAlert size={18} className="mx-auto mb-2 text-cyan-200" /><h3>{title}</h3><p>{description}</p>{actionLabel && onAction && <div className={styles.emptyActions}><button className={styles.button} onClick={onAction}>{actionLabel}</button>{secondaryLabel && <button className={`${styles.button} ${styles.buttonSecondary}`} disabled>{secondaryLabel}</button>}</div>}</div></div>;
}

// Compact worker status for the Studio header only.
// Uses the real /api/system/autonomic-health (no task content, no auth bypass).
function WorkerStatus() {
  type WState = "checking" | "online" | "degraded" | "offline";
  const [state, setState] = useState<WState>("checking");
  const [detail, setDetail] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<null | {
    queued?: number; running?: number; failed?: number;
    lastHeartbeat?: string | null; lastSuccess?: string | null;
  }>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/system/autonomic-health", { cache: "no-store" });
      if (!res.ok) { setState("degraded"); return; }
      const j = await res.json() as {
        worker?: string; status?: string;
        queuedTasks?: number; runningTasks?: number; failedTasks?: number;
        lastWorkerHeartbeat?: string | null; lastSuccessfulTask?: string | null;
      };
      const w = (j.worker || j.status || "offline").toLowerCase();
      const mapped: WState = w === "online" ? "online" : w === "degraded" ? "degraded" : "offline";
      setState(mapped);
      setData({
        queued: j.queuedTasks,
        running: j.runningTasks,
        failed: j.failedTasks,
        lastHeartbeat: j.lastWorkerHeartbeat ?? null,
        lastSuccess: j.lastSuccessfulTask ?? null,
      });
      setDetail(`worker: ${j.worker || "unknown"}`);
    } catch {
      setState("offline");
      setDetail("unreachable");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let vis = typeof document === "undefined" ? true : !document.hidden;

    const onVis = () => {
      const next = !document.hidden;
      if (next === vis) return;
      vis = next;
      if (vis && alive) void fetchHealth();
    };
    document.addEventListener("visibilitychange", onVis);

    void fetchHealth();
    const id = setInterval(() => { if (vis && alive) void fetchHealth(); }, 30000);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchHealth]);

  const color =
    state === "online" ? "#22c55e" :
    state === "degraded" ? "#f59e0b" :
    state === "offline" ? "#ef4444" : "#888";

  const label = state === "checking" ? "checking" : state;

  return (
    <div style={{ position: "relative" }}>
      <button
        className={styles.module}
        onClick={() => setOpen(o => !o)}
        title={detail || "Worker status"}
        aria-label={`Worker ${label}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span aria-hidden style={{ color, fontSize: 10, lineHeight: 1 }}>●</span>
        <span>Worker {label}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", top: "100%", left: 0, zIndex: 50,
            marginTop: 6, minWidth: 220, padding: "8px 10px",
            background: "#0b0f1a", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, fontSize: 11, color: "#ddd", boxShadow: "0 10px 30px rgba(0,0,0,0.4)"
          }}
        >
          <div style={{ marginBottom: 6, opacity: 0.8 }}>Autonomic worker</div>
          <div>Queued: <strong>{data?.queued ?? "—"}</strong></div>
          <div>Running: <strong>{data?.running ?? "—"}</strong></div>
          <div>Failed: <strong>{data?.failed ?? "—"}</strong></div>
          <div style={{ marginTop: 6, fontSize: 10, opacity: 0.7 }}>
            Last heartbeat: {data?.lastHeartbeat ? new Date(data.lastHeartbeat).toLocaleTimeString() : "—"}
          </div>
          <div style={{ fontSize: 10, opacity: 0.7 }}>
            Last success: {data?.lastSuccess ? new Date(data.lastSuccess).toLocaleTimeString() : "—"}
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudioCommandDeck({
  mode,
  onModeChangeAction,
  activeProjectId,
  onOpenProjectsAction,
  conversation,
  terminal,
  mobileView,
  onMobileViewChange,
  onMobileTerminalFocusChange,
  onActiveWindowChange,
  onActiveFileChange,
  onSelectedAssetChange,
}: DeckProps) {
  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT);
  const [draft, setDraft] = useState("// Demo draft — connect a project to edit real files.\nexport const studioMode = \"code\";\n");
  const [mobilePanel, setMobilePanel] = useState<"editor" | "explorer" | "preview" | "review">("editor");

  // Mobile: when true, the docked terminal becomes the full workspace surface (chat/composer hidden, bottom nav stays)
  const [mobileTerminalFocus, setMobileTerminalFocus] = useState(false);

  // Controlled mobile view from parent. Falls back to internal state for uncontrolled usage.
  const [internalMobileView, setInternalMobileView] = useState<"chat" | "build" | "files" | "preview" | "terminal">("chat");
  const effectiveMobileView = mobileView ?? internalMobileView;
  const setMobileView = (v: "chat" | "build" | "files" | "preview" | "terminal") => {
    setInternalMobileView(v);
    onMobileViewChange?.(v);
  };

  // Helpers are defined before any effect/use that calls them to avoid TDZ lint errors.
  const setCollapsed = (panel: PanelId) => setLayout((current) => ({ ...current, collapsed: { ...current.collapsed, [panel]: !current.collapsed[panel] } }));
  const setPanelSize = (panel: PanelId, size: number) => { const [min, max] = LIMITS[panel]; const clamped = Math.min(max, Math.max(min, Math.round(size))); setLayout((current) => current.sizes[panel] === clamped ? current : ({ ...current, sizes: { ...current.sizes, [panel]: clamped } })); };
  const resetLayout = () => setLayout(DEFAULT_LAYOUT);

  // Sync controlled mobileView into internal terminal focus + mode so the UI and CSS react.
  // This makes the parent (mobile chrome + shell) the single source of truth.
  useEffect(() => {
    // Keep the active builder window in sync so chat context (project/file/selection) reflects the visible surface.
    const windowForView: Record<"chat" | "build" | "files" | "preview" | "terminal", string> = {
      chat: "conversation",
      build: "mission",
      files: "files",
      preview: "preview",
      terminal: "terminal",
    };
    onActiveWindowChange?.(windowForView[effectiveMobileView] ?? null);

    if (effectiveMobileView === "terminal") {
      setMobileTerminalFocus(true);
      onMobileTerminalFocusChange?.(true);
      if (layout.collapsed.terminal) {
        // toggle to expand
        setCollapsed("terminal");
      }
    } else if (effectiveMobileView === "chat") {
      setMobileTerminalFocus(false);
      onMobileTerminalFocusChange?.(false);
    } else if (effectiveMobileView === "build") {
      onModeChangeAction("command");
      setMobileTerminalFocus(false);
      onMobileTerminalFocusChange?.(false);
    } else if (effectiveMobileView === "preview") {
      onModeChangeAction("media");
      setMobileTerminalFocus(false);
      onMobileTerminalFocusChange?.(false);
    } else if (effectiveMobileView === "files") {
      setMobileTerminalFocus(false);
      onMobileTerminalFocusChange?.(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMobileView]);

  // Dev-only: detect duplicate deck mounts
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const key = "__littStudioCommandDeckCount";
    const w = window as typeof window & Record<string, number>;
    w[key] = (w[key] ?? 0) + 1;
    if (w[key] > 1) {
      console.error("[LiTT Studio] Multiple StudioCommandDeck mounted");
    }
    return () => {
      w[key] = Math.max(0, (w[key] ?? 1) - 1);
    };
  }, []);

  useIsoLayoutEffect(() => {
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

  const selectRail = (id: RailItem["id"]) => {
    if (id === "code" || id === "media" || id === "command") {
      onModeChangeAction(id);
      setMobileTerminalFocus(false);
      onMobileTerminalFocusChange?.(false);
    }
    if (id === "files") {
      onOpenProjectsAction();
      setMobileView("files");
    }
    if (id === "terminal") {
      // On mobile, make the docked terminal the full workspace surface (chat/composer hidden via CSS).
      // Always also toggle collapse so the body is visible.
      const isSmall = typeof window !== "undefined" && window.innerWidth <= 700;
      setCollapsed("terminal");
      setMobileView("terminal");
      if (isSmall) {
        setMobileTerminalFocus((v) => {
          const next = !v;
          onMobileTerminalFocusChange?.(next);
          return next;
        });
      }
    }
  };
  // Always-on 3-column layout when conversation is provided: rail | workspace | conversation (360-420px)
  const hasConversation = !!conversation;

  // When a dedicated conversation is provided by the parent, collapse the internal review panel
  // so the workspace column doesn't grow an extra right sidebar next to the LiTT conversation.
  const effectiveCollapsed = {
    ...layout.collapsed,
    review: hasConversation ? true : layout.collapsed.review,
  };

  const projectLabel = activeProjectId ? `Project ${activeProjectId.slice(0, 8)}` : "No project";
  const explorerW = effectiveCollapsed.explorer ? 42 : layout.sizes.explorer;
  const reviewW = effectiveCollapsed.review ? 42 : layout.sizes.review;
  const previewH = effectiveCollapsed.preview ? 42 : layout.sizes.preview;
  const terminalH = effectiveCollapsed.terminal ? 42 : layout.sizes.terminal;
  // Allocate 24px for splitter columns/rows so the interactive resize handles meet the 24px touch target rule.
  // The visual appearance stays a thin bar; the extra space is hit area.
  const codeGridStyle: CSSProperties = { gridTemplateColumns: `${explorerW}px ${effectiveCollapsed.explorer ? 0 : 24}px minmax(0,1fr) ${effectiveCollapsed.review ? 0 : 24}px ${reviewW}px`, gridTemplateRows: `minmax(0,1fr) ${effectiveCollapsed.terminal ? 0 : 24}px ${terminalH}px` };
  const stackGridStyle: CSSProperties = { gridTemplateRows: `minmax(0,1fr) ${effectiveCollapsed.preview ? 0 : 24}px ${previewH}px` };

  // Use CSS class for the 3-col layout instead of inline style.
  const deckClass = `${styles.deck} ${hasConversation ? styles.deckWithConversation : ""}`;

  // Mobile terminal focus: conversation is hidden (terminal becomes full workspace)
  // When a controlled mobileView is provided by the parent (StudioMobileChrome / shell),
  // respect it as the source of truth for which surface is primary on mobile.
  const showConversation = hasConversation && (() => {
    if (mobileView) {
      // Explicit controlled view takes precedence.
      if (mobileView === "terminal") return false;
      if (mobileView === "chat") return true;
      // For build/files/preview we still allow conversation unless terminal is focused.
      return !mobileTerminalFocus;
    }
    return !mobileTerminalFocus;
  })();

  return (
    <section className={deckClass} data-mobile-terminal={mobileTerminalFocus ? "true" : "false"}>
      <aside className={styles.rail} aria-label="Studio tools">{RAIL.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => selectRail(id)} data-label={label} data-active={id === mode} aria-label={label} title={label}><Icon size={18} /></button>)}</aside>

      {/* Workspace area (mode-specific content) */}
      <div className={styles.workspace}>
        <header className={styles.commandBar}>
          <div className={styles.brand}><span className={styles.brandMark}><Sparkles size={15} /></span><span>LiTT</span></div>
          <WorkerStatus />
          <div className={styles.modules}>
            <button className={styles.module} onClick={onOpenProjectsAction}><FolderOpen size={12} /><strong>{projectLabel}</strong><ChevronDown size={11} /></button>
            <span className={styles.module}><GitBranch size={12} /><strong>{activeProjectId ? "Branch unavailable" : "No branch"}</strong></span>
            <span className={styles.module}><Monitor size={12} />Preview <strong>Unavailable</strong></span>
            <span className={styles.module}><Cloud size={12} />Services <strong>Not connected</strong></span>
            <span className={styles.module}><Sparkles size={12} />Credits <strong>Unavailable</strong></span>
          </div>
          <div className={styles.actions}><button className={styles.iconButton} onClick={resetLayout} aria-label="Reset Studio layout" title="Reset layout">↺</button><button className={styles.iconButton} aria-label="Notifications" title="Notifications"><Bell size={14} /></button><button className={styles.iconButton} aria-label="Profile" title="Profile"><Users size={14} /></button></div>
        </header>

        {mode === "code" && <div className={`${styles.main} ${styles.codeMain}`} style={codeGridStyle} data-active-mobile={mobilePanel}>
          <div className={styles.mobileTabBar}>{(["editor", "explorer", "preview", "review"] as const).map((p) => <button key={p} data-active={mobilePanel === p} onClick={() => setMobilePanel(p)}>{p === "explorer" ? "files" : p}</button>)}</div>
          <Panel title="Explorer" icon={FolderOpen} panelId="explorer" dataMobileId="explorer" collapsed={layout.collapsed.explorer} onCollapseAction={() => setCollapsed("explorer")} style={{ gridColumn: 1, gridRow: 1 }} className={styles.explorerPanel} action={<button onClick={onOpenProjectsAction} aria-label="Select project" style={{ minWidth: 24, minHeight: 24, padding: 4 }}><FolderOpen size={13} /></button>}>
            {activeProjectId ? <div className={styles.fileTree}><div className={styles.fileRow}><FileCode2 size={13} /> File index loading is unavailable</div></div> : <EmptyState title="No project selected" description="Choose a connected project to load files, preview, and Git status." actionLabel="Select project" onAction={onOpenProjectsAction} secondaryLabel="Connect GitHub" />}
          </Panel>
          {!layout.collapsed.explorer && <Splitter panel="explorer" size={layout.sizes.explorer} onResizeAction={setPanelSize} style={{ gridColumn: 2, gridRow: 1 }} />}
          <div className={styles.stack} style={{ gridColumn: 3, gridRow: 1, ...stackGridStyle }}>
            <Panel title="Editor" icon={Braces} dataMobileId="editor" style={{ gridRow: 1 }} action={<><button aria-label="Unsaved demo draft" style={{ minWidth: 24, minHeight: 24, padding: 4 }}><span className="text-[9px]">Demo</span></button><button aria-label="Maximize editor" style={{ minWidth: 24, minHeight: 24, padding: 4 }}><Maximize2 size={13} /></button></>}><div className={styles.editor}><StudioMonacoEditor value={draft} onChange={setDraft} /></div></Panel>
            {!layout.collapsed.preview && <Splitter panel="preview" size={layout.sizes.preview} vertical invert onResizeAction={setPanelSize} style={{ gridRow: 2 }} />}
            <Panel title="Live preview" icon={Monitor} panelId="preview" dataMobileId="preview" collapsed={layout.collapsed.preview} onCollapseAction={() => setCollapsed("preview")} style={{ gridRow: 3 }} action={<div className={styles.tabs}>{(["desktop", "tablet", "mobile"] as const).map((device) => <button key={device} data-active={layout.previewDevice === device} onClick={() => setLayout((current) => ({ ...current, previewDevice: device }))}>{device}</button>)}</div>}><div className={styles.previewCanvas}><EmptyState title="Preview unavailable" description={`A project runtime has not been provisioned for ${layout.previewDevice} preview.`} actionLabel="View requirements" onAction={() => undefined} /></div></Panel>
          </div>
          {!layout.collapsed.review && <Splitter panel="review" size={layout.sizes.review} invert onResizeAction={setPanelSize} style={{ gridColumn: 4, gridRow: 1 }} />}
          <Panel title="Review" icon={GitBranch} panelId="review" dataMobileId="review" collapsed={layout.collapsed.review} onCollapseAction={() => setCollapsed("review")} style={{ gridColumn: 5, gridRow: 1 }} className={styles.rightPanel}><div className={styles.rightTabs}>{(["activity", "agents", "git"] as const).map((tab) => <button key={tab} data-active={layout.rightTab === tab} onClick={() => setLayout((current) => ({ ...current, rightTab: tab }))}>{tab}</button>)}</div>{layout.rightTab === "activity" && <div className={styles.activity}><div className={styles.activityItem}><Activity size={13} /> No verified project activity.</div></div>}{layout.rightTab === "agents" && <EmptyState title="No active agents" description="Agent events appear when a verified project task runs." />}{layout.rightTab === "git" && <EmptyState title="Git unavailable" description="Changed files, exact diffs, approval, reject, and undo appear after Git workspace provisioning." />}</Panel>
          {!layout.collapsed.terminal && <Splitter panel="terminal" size={layout.sizes.terminal} vertical invert onResizeAction={setPanelSize} style={{ gridColumn: "1 / -1", gridRow: 2 }} />}
          <DockedTerminal terminal={terminal} collapsed={layout.collapsed.terminal} onCollapseAction={() => setCollapsed("terminal")} />
        </div>}

        {mode === "media" && <div className={`${styles.main} ${styles.modeMain}`}><Panel title="Media pipeline" icon={Video}><div className={styles.modeHero}><div><h2>Generate, render, and organize.</h2><p>Image, video, audio, and assets share the selected project context.</p></div><div className={styles.timeline}><article><span>Stage 01</span><strong>Prompt & planning</strong><p>Unavailable</p></article><article><span>Stage 02</span><strong>Render queue</strong><p>No active jobs</p></article><article><span>Stage 03</span><strong>Artifacts</strong><p>Empty</p></article></div></div></Panel><aside className={styles.modeSidebar}><Panel title="Preview" icon={Play}><EmptyState title="Render preview unavailable" description="Start a provider-backed job to view progress and output." /></Panel><Panel title="Usage" icon={Activity}><EmptyState title="Provider usage unavailable" description="Usage and cost appear from a connected provider." /></Panel></aside><DockedTerminal terminal={terminal} collapsed={layout.collapsed.terminal} onCollapseAction={() => setCollapsed("terminal")} /></div>}

        {mode === "command" && (
          <div className={`${styles.main} ${styles.commandModeMain}`}>
            <Panel
              title="Mission command center"
              icon={Workflow}
              className={styles.commandMission}
            >
              <div className={styles.modeHeroCompact}>
                <div className={styles.modeHeroIntro}>
                  <h2>Mission control</h2>
                  <p>
                    Connect a project or describe what you want LiTT to build.
                  </p>
                  <div className={styles.emptyActions}>
                    <button className={styles.button} onClick={onOpenProjectsAction}>
                      Select Project
                    </button>
                    <button
                      className={`${styles.button} ${styles.buttonSecondary}`}
                      disabled={!activeProjectId}
                    >
                      Start Mission
                    </button>
                  </div>
                </div>
                <div className={styles.workflowSteps}>
                  {["Inspect", "Plan", "Execute", "Review", "Deploy"].map((step, index, steps) => (
                    <span key={step} style={{ display: "contents" }}>
                      <span className={styles.workflowStep}>{step}</span>
                      {index < steps.length - 1 && (
                        <span className={styles.workflowArrow}>→</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </Panel>

            <aside className={`${styles.modeSidebar} ${styles.commandSidebar}`}>
              <Panel title="System activity" icon={Activity}>
                <div className={styles.activityTimeline}>
                  <div className={styles.activityItem}>
                    <Activity size={13} /> Waiting for project connection
                  </div>
                  <div className={styles.activityItem}>
                    <Cloud size={13} /> Services will appear after verification
                  </div>
                  <div className={styles.activityItem}>
                    <Bot size={13} /> Agent events will appear during missions
                  </div>
                </div>
              </Panel>
            </aside>

            <DockedTerminal terminal={terminal} collapsed={layout.collapsed.terminal} onCollapseAction={() => setCollapsed("terminal")} />
          </div>
        )}

        <nav className={styles.bottomNav} aria-label="Studio tools">{RAIL.slice(0, 6).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => selectRail(id)} data-active={id === mode}><Icon size={16} /><span>{label}</span></button>)}</nav>
      </div>

      {/* Dedicated conversation column on the right.
          Controlled by mobileView when provided (parent is the single source of truth).
          Example: on mobile, only render conversation when mobileView === "chat". */}
      {(mobileView ? mobileView === "chat" : true) && showConversation && (
        <div className={styles.conversationPanel}>
          {conversation}
        </div>
      )}
    </section>
  );
}
