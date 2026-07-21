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
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./studio-command-deck.module.css";
import GeminiModelPicker, { type ChatModelSelection } from "./GeminiModelPicker";
import AgentPicker from "./AgentPicker";
import AgentTool from "../tools/AgentTool";
import type { AgentId } from "@/app/agents/store/stationStore";
import { AGENTS } from "@/lib/agents";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function RailTooltip({ label, children, active, onClick }: { label: string; children: ReactNode; active?: boolean; onClick?: () => void; }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const updatePos = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.top + rect.height / 2, left: rect.right + 10 });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        data-active={active}
        aria-label={label}
        className={styles.railButton}
        onMouseEnter={() => { updatePos(); setOpen(true); }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => { updatePos(); setOpen(true); }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <span
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            zIndex: 100000,
            transform: "translateY(-50%)",
            pointerEvents: "none",
            whiteSpace: "nowrap",
            border: "1px solid rgba(126,151,218,.28)",
            borderRadius: 7,
            background: "rgba(3,7,18,.98)",
            padding: "5px 8px",
            color: "white",
            fontSize: 11,
            fontWeight: 700,
            boxShadow: "0 10px 30px rgba(0,0,0,.55)",
          }}
        >
          {label}
        </span>,
        document.body,
      )}
    </>
  );
}

// Workspace editor components (dynamically loaded to avoid Monaco SSR)
const WorkspaceEditor = dynamic(() => import("../code/WorkspaceEditor"), { ssr: false });
const WorkspaceExplorer = dynamic(() => import("../code/WorkspaceExplorer"), { ssr: false });
const EditorTabs = dynamic(() => import("../code/EditorTabs"), { ssr: false });
const SaveStatus = dynamic(() => import("../code/SaveStatus"), { ssr: false });
import { useWorkspaceFiles } from "../code/useWorkspaceFiles";

// Dev-only: detect duplicate deck mounts (must run at module scope for the component root)
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  const _w = window as typeof window & Record<string, number>;
  // will be incremented in the component effect below
}

export type StudioCommandDeckMode = "code" | "media" | "command";
export type CommandSurface = "mission" | "agents";

type StudioActivityEvent = {
  id: string;
  type: "project" | "workspace" | "agent" | "terminal" | "preview" | "mission" | "git" | "deployment";
  status: "info" | "running" | "success" | "warning" | "error";
  message: string;
  createdAt: number;
};

type DeckProps = {
  mode: StudioCommandDeckMode;
  onModeChangeAction: (mode: StudioCommandDeckMode) => void;
  activeProjectId: string | null;
  projectName: string | null;
  projectStatus: "none" | "loading" | "connected" | "error";
  branchName: string | null;
  workspaceStatus: "unavailable" | "provisioning" | "ready" | "error";
  previewStatus: "unavailable" | "starting" | "ready" | "error";
  servicesStatus: "disconnected" | "connecting" | "connected" | "degraded";
  scanStatus?: "pending" | "scanning" | "ready" | "failed";
  workspaceId?: string | null;
  activityEvents: StudioActivityEvent[];
  onOpenProjectsAction: () => void;
  onInspectProjectAction?: () => void;
  onStartBuildAction?: () => void;
  onCreateMediaAction?: () => void;
  onPrepareWorkspaceAction?: () => void;
  selectedModel: ChatModelSelection;
  onModelChange: (model: ChatModelSelection) => void;
  commandSurface: CommandSurface;
  onCommandSurfaceChangeAction: (surface: CommandSurface) => void;
  selectedAgentId: AgentId | null;
  onSelectAgentAction: (agentId: AgentId) => void;
  onOpenAgentChatAction: (agentId: AgentId) => void;
  onAssignMissionAction: (agentId: AgentId) => void;
  onOpenAgentTerminalAction: (agentId: AgentId) => void;
  busyAgentId?: AgentId | null;
  conversation: ReactNode;
  terminal: ReactNode;
  mobileView?: "chat" | "build" | "files" | "preview" | "terminal";
  onMobileViewChange?: (view: "chat" | "build" | "files" | "preview" | "terminal") => void;
  onMobileTerminalFocusChange?: (focused: boolean) => void;
  onActiveWindowChange?: (id: string | null) => void;
  onActiveFileChange?: (path: string | null) => void;
  onSelectedAssetChange?: (path: string | null) => void;
};

type RailItem = { id: StudioCommandDeckMode | "files" | "agents" | "terminal" | "settings"; label: string; icon: LucideIcon };

const RAIL: RailItem[] = [
  { id: "command", label: "Mission", icon: Workflow },
  { id: "code", label: "Code", icon: Code2 },
  { id: "media", label: "Media", icon: Video },
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
  agentName,
  agentColor,
  projectName,
  workspaceLabel,
}: {
  terminal: ReactNode;
  collapsed: boolean;
  onCollapseAction: () => void;
  agentName?: string;
  agentColor?: string;
  projectName?: string | null;
  workspaceLabel?: string;
}) {
  return (
    <section
      className={`${styles.dockedTerminal} ${collapsed ? styles.dockedTerminalCollapsed : ""}`}
    >
      <header className={styles.dockedTerminalHeader}>
        <span className={styles.terminalLabel}>
          Terminal
          {agentName && (
            <span
              className="ml-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold"
              style={{
                color: agentColor ?? "#29e4ff",
                backgroundColor: `${agentColor ?? "#29e4ff"}15`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: agentColor ?? "#29e4ff" }}
              />
              {agentName}
            </span>
          )}
          {projectName && (
            <span className="ml-2 text-[9px] text-white/40">
              Project: {projectName}
            </span>
          )}
          {workspaceLabel && (
            <span
              className="ml-2 text-[9px] font-bold"
              style={{
                color:
                  workspaceLabel === "Ready" ? "#43f59b" :
                  workspaceLabel === "Error" ? "#ef4444" :
                  workspaceLabel === "Provisioning…" ? "#29e4ff" :
                  "#facc15",
              }}
            >
              Workspace: {workspaceLabel}
            </span>
          )}
          <span className="ml-2 text-[9px] text-white/30">Shell: Local</span>
        </span>

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

function StatusChip({ label, value }: { label: string; value: string }) {
  const tone = (() => {
    const v = value.toLowerCase();
    if (v === "ready" || v === "imported" || v === "project") return "ok";
    if (v === "not prepared" || v === "pending" || v === "scanning" || v === "requires runtime" || v === "local") return "warn";
    if (v === "failed" || v === "error" || v === "missing") return "err";
    return "info";
  })();
  const color = tone === "ok" ? "#34d399" : tone === "warn" ? "#fbbf24" : tone === "err" ? "#fb7185" : "#67e8f9";
  return (
    <span
      className={styles.statusChip}
      style={{ borderColor: `${color}40`, color, backgroundColor: `${color}10` }}
    >
      <span className={styles.statusChipLabel}>{label}</span>
      <span className={styles.statusChipValue}>{value}</span>
    </span>
  );
}

export default function StudioCommandDeck({
  mode,
  onModeChangeAction,
  activeProjectId,
  projectName,
  projectStatus,
  branchName,
  workspaceStatus,
  previewStatus,
  servicesStatus,
  scanStatus,
  workspaceId,
  activityEvents,
  onOpenProjectsAction,
  onInspectProjectAction,
  onStartBuildAction,
  onCreateMediaAction,
  onPrepareWorkspaceAction,
  selectedModel,
  onModelChange,
  commandSurface,
  onCommandSurfaceChangeAction,
  selectedAgentId,
  onSelectAgentAction,
  onOpenAgentChatAction,
  onAssignMissionAction,
  onOpenAgentTerminalAction,
  busyAgentId,
  conversation,
  terminal,
  mobileView,
  onMobileViewChange,
  onMobileTerminalFocusChange,
  onActiveWindowChange,
  onActiveFileChange: _onActiveFileChange,
  onSelectedAssetChange: _onSelectedAssetChange,
}: DeckProps) {
  const [layout, setLayout] = useState<LayoutState>(DEFAULT_LAYOUT);
  const [mobilePanel, setMobilePanel] = useState<"editor" | "explorer" | "preview" | "review">("editor");

  // Real workspace file system
  const ws = useWorkspaceFiles(workspaceId ?? null);

  // Agent context for terminal header
  const activeAgentInfo = AGENTS[selectedAgentId ?? "litt"];
  const terminalAgentName = activeAgentInfo?.name;
  const terminalAgentColor = activeAgentInfo?.color;

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
      if (id === "command") onCommandSurfaceChangeAction("mission");
      setMobileTerminalFocus(false);
      onMobileTerminalFocusChange?.(false);
    }
    if (id === "agents") {
      onModeChangeAction("command");
      onCommandSurfaceChangeAction("agents");
      onActiveWindowChange?.("agents");
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

  const projectLabel = projectStatus === "loading" ? "Loading…" : projectName ?? (activeProjectId ? `Project ${activeProjectId.slice(0, 8)}` : "No project");
  const branchLabel = branchName ?? (activeProjectId ? "Pending workspace" : "No branch");
  const previewLabel = previewStatus === "ready" ? "Ready" : previewStatus === "starting" ? "Starting…" : previewStatus === "error" ? "Error" : "Requires runtime";
  const servicesLabel = servicesStatus === "connected" ? "Connected" : servicesStatus === "connecting" ? "Connecting…" : servicesStatus === "degraded" ? "Degraded" : "Disconnected";
  const workspaceLabel = workspaceStatus === "ready" ? "Ready" : workspaceStatus === "provisioning" ? "Provisioning…" : workspaceStatus === "error" ? "Error" : "Not prepared";
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
      <aside className={styles.rail} aria-label="Studio tools">
        <div className={styles.railGroup}>
          {RAIL.slice(0, 3).map(({ id, label, icon: Icon }) => (
            <RailTooltip key={id} label={label} active={id === mode} onClick={() => selectRail(id)}>
              <Icon size={18} />
            </RailTooltip>
          ))}
        </div>
        <span className={styles.railDivider} aria-hidden="true" />
        <div className={styles.railGroup}>
          {RAIL.slice(3).map(({ id, label, icon: Icon }) => (
            <RailTooltip key={id} label={label} active={id === mode} onClick={() => selectRail(id)}>
              <Icon size={18} />
            </RailTooltip>
          ))}
        </div>
      </aside>

      <header className={styles.commandBar}>
        <div className={styles.brand}><span className={styles.brandMark}><Sparkles className="pointer-events-none" size={15} aria-hidden="true" /></span><span>LiTT</span></div>
        <GeminiModelPicker value={selectedModel} onChange={onModelChange} />
        <AgentPicker value={selectedAgentId ?? "litt"} onChange={onSelectAgentAction} />
        <div className={styles.modules}>
          <button data-module="project" className={styles.module} onClick={onOpenProjectsAction}><FolderOpen className="pointer-events-none" size={12} aria-hidden="true" /><strong>{projectLabel}</strong><ChevronDown className="pointer-events-none" size={11} aria-hidden="true" /></button>
          <span data-module="branch" className={styles.module}><GitBranch size={12} />Branch <strong>{branchLabel}</strong></span>
          <span className={styles.statusDivider} aria-hidden="true" />
          <span data-module="preview" className={styles.module}><Monitor size={12} />Preview <strong>{previewLabel}</strong></span>
          <span data-module="services" className={styles.module}><Cloud size={12} />Services <strong>{servicesLabel}</strong></span>
          <span data-module="credits" className={styles.module}><Sparkles size={12} />Credits <strong>9,999</strong></span>
        </div>
        <div className={styles.actions}><button className={styles.iconButton} onClick={resetLayout} aria-label="Reset Studio layout" title="Reset layout">↺</button><button className={styles.iconButton} aria-label="Notifications" title="Notifications"><Bell size={14} /></button><button className={styles.iconButton} aria-label="Profile" title="Profile"><Users size={14} /></button></div>
      </header>

      {/* Workspace area (mode-specific content) */}
      <div className={styles.workspace}>
        {mode === "code" && <div className={`${styles.main} ${styles.codeMain}`} style={codeGridStyle} data-active-mobile={mobilePanel}>
          <div className={styles.mobileTabBar}>{(["editor", "explorer", "preview", "review"] as const).map((p) => <button key={p} data-active={mobilePanel === p} onClick={() => setMobilePanel(p)}>{p === "explorer" ? "files" : p}</button>)}</div>
          <Panel title="Explorer" icon={FolderOpen} panelId="explorer" dataMobileId="explorer" collapsed={layout.collapsed.explorer} onCollapseAction={() => setCollapsed("explorer")} style={{ gridColumn: 1, gridRow: 1 }} className={styles.explorerPanel} action={<button onClick={() => void ws.refreshTree()} aria-label="Refresh files" style={{ minWidth: 24, minHeight: 24, padding: 4 }}><FolderOpen size={13} /></button>}>
            {workspaceId ? <WorkspaceExplorer tree={ws.tree} loading={ws.treeLoading} activePath={ws.activePath} onOpenFile={(p) => void ws.openFile(p)} onRefresh={() => void ws.refreshTree()} /> : <EmptyState title="No project selected" description="Choose a connected project to load files, preview, and Git status." actionLabel="Select project" onAction={onOpenProjectsAction} secondaryLabel="Connect GitHub" />}
          </Panel>
          {!layout.collapsed.explorer && <Splitter panel="explorer" size={layout.sizes.explorer} onResizeAction={setPanelSize} style={{ gridColumn: 2, gridRow: 1 }} />}
          <div className={styles.stack} style={{ gridColumn: 3, gridRow: 1, ...stackGridStyle }}>
            <Panel title="Editor" icon={Braces} dataMobileId="editor" style={{ gridRow: 1 }} action={<div className="flex items-center gap-2">{ws.activePath && ws.files[ws.activePath] && <SaveStatus isDirty={ws.files[ws.activePath].dirty} isSaving={ws.savingPaths.has(ws.activePath)} error={ws.error} />}<button aria-label="Maximize editor" style={{ minWidth: 24, minHeight: 24, padding: 4 }}><Maximize2 size={13} /></button></div>}><div className={styles.editor}><EditorTabs openTabs={ws.openTabs} activePath={ws.activePath} files={ws.files} savingPaths={ws.savingPaths} onSelect={(p) => ws.setActivePath(p)} onClose={(p) => ws.closeTab(p)} /><div style={{ height: ws.openTabs.length > 0 ? "calc(100% - 32px)" : "100%", minHeight: 0 }}><WorkspaceEditor path={ws.activePath} file={ws.activePath ? ws.files[ws.activePath] ?? null : null} onChange={(p, c) => ws.updateBuffer(p, c)} onSave={(p) => void ws.saveFile(p)} /></div></div></Panel>
            {!layout.collapsed.preview && <Splitter panel="preview" size={layout.sizes.preview} vertical invert onResizeAction={setPanelSize} style={{ gridRow: 2 }} />}
            <Panel title="Live preview" icon={Monitor} panelId="preview" dataMobileId="preview" collapsed={layout.collapsed.preview} onCollapseAction={() => setCollapsed("preview")} style={{ gridRow: 3 }} action={<div className={styles.tabs}>{(["desktop", "tablet", "mobile"] as const).map((device) => <button key={device} data-active={layout.previewDevice === device} onClick={() => setLayout((current) => ({ ...current, previewDevice: device }))}>{device}</button>)}</div>}><div className={styles.previewCanvas}><EmptyState title="Preview unavailable" description={`A project runtime has not been provisioned for ${layout.previewDevice} preview.`} actionLabel="Open project" onAction={onOpenProjectsAction} /></div></Panel>
          </div>
          {!layout.collapsed.review && <Splitter panel="review" size={layout.sizes.review} invert onResizeAction={setPanelSize} style={{ gridColumn: 4, gridRow: 1 }} />}
          <Panel title="Review" icon={GitBranch} panelId="review" dataMobileId="review" collapsed={layout.collapsed.review} onCollapseAction={() => setCollapsed("review")} style={{ gridColumn: 5, gridRow: 1 }} className={styles.rightPanel}><div className={styles.rightTabs}>{(["activity", "agents", "git"] as const).map((tab) => <button key={tab} data-active={layout.rightTab === tab} onClick={() => setLayout((current) => ({ ...current, rightTab: tab }))}>{tab}</button>)}</div>{layout.rightTab === "activity" && <div className={styles.activity}><div className={styles.activityItem}><Activity size={13} /> No verified project activity.</div></div>}{layout.rightTab === "agents" && <EmptyState title="No active agents" description="Agent events appear when a verified project task runs." actionLabel="Open agents" onAction={() => selectRail('agents')} />}{layout.rightTab === "git" && <EmptyState title="Git unavailable" description="Changed files, exact diffs, approval, reject, and undo appear after Git workspace provisioning." actionLabel="Open project" onAction={onOpenProjectsAction} />}</Panel>
          {!layout.collapsed.terminal && <Splitter panel="terminal" size={layout.sizes.terminal} vertical invert onResizeAction={setPanelSize} style={{ gridColumn: "1 / -1", gridRow: 2 }} />}
          <DockedTerminal terminal={terminal} collapsed={layout.collapsed.terminal} onCollapseAction={() => setCollapsed("terminal")} agentName={terminalAgentName} agentColor={terminalAgentColor} projectName={projectName} workspaceLabel={workspaceLabel} />
        </div>}

        {mode === "media" && <div className={`${styles.main} ${styles.modeMain}`}><Panel title="Media pipeline" icon={Video}><div className={styles.modeHero}><div><h2>Generate, render, and organize.</h2><p>Image, video, audio, and assets share the selected project context.</p></div><div className={styles.timeline}><article><span>Stage 01</span><strong>Prompt & planning</strong><p>Unavailable</p><button className={styles.button} onClick={() => selectRail('command')}>Plan prompt</button></article><article><span>Stage 02</span><strong>Render queue</strong><p>No active jobs</p><button className={styles.button} onClick={() => selectRail('command')}>Queue render</button></article><article><span>Stage 03</span><strong>Artifacts</strong><p>Empty</p><button className={styles.button} onClick={() => selectRail('files')}>Open library</button></article></div></div></Panel><aside className={styles.modeSidebar}><Panel title="Preview" icon={Play}><EmptyState title="Render preview unavailable" description="Start a provider-backed job to view progress and output." actionLabel="Open project" onAction={onOpenProjectsAction} /></Panel><Panel title="Usage" icon={Activity}><EmptyState title="Provider usage unavailable" description="Usage and cost appear from a connected provider." actionLabel="Open project" onAction={onOpenProjectsAction} /></Panel></aside><DockedTerminal terminal={terminal} collapsed={layout.collapsed.terminal} onCollapseAction={() => setCollapsed("terminal")} agentName={terminalAgentName} agentColor={terminalAgentColor} /></div>}

        {mode === "command" && commandSurface === "mission" && (
          <div className={`${styles.main} ${styles.commandModeMain}`}>
            <Panel
              title="Mission command center"
              icon={Workflow}
              className={styles.commandMission}
            >
              <div className={styles.modeHeroCompact}>
                <div className={styles.modeHeroIntro}>
                  {projectStatus === "none" && (
                    <>
                      <h2>Mission control</h2>
                      <p>No project selected. Connect or create a project before starting a mission.</p>
                      <div className={styles.emptyActions}>
                        <button className={styles.button} onClick={onOpenProjectsAction}>Select Project</button>
                      </div>
                    </>
                  )}
                  {projectStatus === "loading" && (
                    <>
                      <h2>Loading project…</h2>
                      <p>Fetching project metadata and checking workspace status.</p>
                    </>
                  )}
                  {projectStatus === "error" && (
                    <>
                      <h2>Project error</h2>
                      <p>Failed to load project metadata. Try selecting the project again.</p>
                      <div className={styles.emptyActions}>
                        <button className={styles.button} onClick={onOpenProjectsAction}>Select Project</button>
                      </div>
                    </>
                  )}
                  {projectStatus === "connected" && workspaceStatus !== "ready" && (
                    <>
                      <h2>{projectName} is connected</h2>
                      <p>Prepare a secure project workspace so {terminalAgentName} can inspect files, run commands and propose edits.</p>
                      <div className={styles.emptyActions}>
                        <button
                          className={styles.button}
                          onClick={onPrepareWorkspaceAction}
                          disabled={workspaceStatus === "provisioning" || scanStatus !== "ready"}
                        >
                          {workspaceStatus === "provisioning" ? "Preparing…" : "Prepare Workspace"}
                        </button>
                        <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={onInspectProjectAction}>Inspect Metadata</button>
                        <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={onCreateMediaAction}>Create Media</button>
                      </div>
                      <div className={styles.statusChips}>
                        <StatusChip label="Repository" value={activeProjectId ? "Imported" : "Missing"} />
                        <StatusChip label="Scan" value={scanStatus ?? "pending"} />
                        <StatusChip label="Workspace" value={workspaceStatus === "provisioning" ? "Preparing" : workspaceStatus === "error" ? "Failed" : "Not prepared"} />
                      </div>
                    </>
                  )}
                  {projectStatus === "connected" && workspaceStatus === "ready" && (
                    <>
                      <h2>Ready to build</h2>
                      <p>Describe the outcome or start a guided mission in {projectName}.</p>
                      <div className={styles.emptyActions}>
                        <button className={styles.button} onClick={onStartBuildAction}>Start Mission</button>
                        <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={onInspectProjectAction}>Inspect Project</button>
                        <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={onCreateMediaAction}>Create Media</button>
                      </div>
                      <div className={styles.statusChips}>
                        <StatusChip label="Repository" value="Imported" />
                        <StatusChip label="Scan" value={scanStatus ?? "ready"} />
                        <StatusChip label="Workspace" value="Ready" />
                        <StatusChip label="Terminal" value={servicesStatus === "connected" ? "Project" : "Local"} />
                        <StatusChip label="Preview" value={previewStatus === "ready" ? "Ready" : previewStatus === "starting" ? "Starting" : "Requires runtime"} />
                      </div>
                    </>
                  )}
                </div>
                <div className={styles.workflowSteps}>
                  {["Inspect", "Plan", "Approve", "Execute", "Verify", "Deploy"].map((step, index, steps) => (
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
                  {activityEvents.length === 0 && (
                    <div className={styles.activityItem}>
                      <Activity size={13} /> No activity yet. Select a project to begin.
                    </div>
                  )}
                  {activityEvents.map((event) => (
                    <div
                      key={event.id}
                      className={styles.activityItem}
                      style={{
                        borderLeftColor:
                          event.status === "error" ? "rgba(239,68,68,.4)" :
                          event.status === "warning" ? "rgba(251,191,36,.4)" :
                          event.status === "success" ? "rgba(67,245,155,.4)" :
                          event.status === "running" ? "rgba(41,228,255,.4)" :
                          "rgba(126,151,218,.2)",
                      }}
                    >
                      {event.type === "project" && <FolderOpen size={13} />}
                      {event.type === "workspace" && <Cloud size={13} />}
                      {event.type === "agent" && <Bot size={13} />}
                      {event.type === "terminal" && <Terminal size={13} />}
                      {event.type === "preview" && <Monitor size={13} />}
                      {event.type === "mission" && <Workflow size={13} />}
                      {event.type === "git" && <GitBranch size={13} />}
                      {event.type === "deployment" && <Sparkles size={13} />}
                      <span>{event.message}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </aside>

            <DockedTerminal terminal={terminal} collapsed={layout.collapsed.terminal} onCollapseAction={() => setCollapsed("terminal")} agentName={terminalAgentName} agentColor={terminalAgentColor} projectName={projectName} workspaceLabel={workspaceLabel} />
          </div>
        )}

        {mode === "command" && commandSurface === "agents" && (
          <div className={`${styles.main} ${styles.agentModeMain}`}>
            <div className={styles.agentWorkspace}>
              <AgentTool
                selectedAgentId={selectedAgentId}
                onSelectAgentAction={onSelectAgentAction}
                onOpenAgentChatAction={onOpenAgentChatAction}
                onAssignMissionAction={onAssignMissionAction}
                onOpenTerminalAction={onOpenAgentTerminalAction}
                busyAgentId={busyAgentId}
              />
            </div>
            <DockedTerminal
              terminal={terminal}
              collapsed={layout.collapsed.terminal}
              onCollapseAction={() => setCollapsed("terminal")}
              agentName={terminalAgentName}
              agentColor={terminalAgentColor}
              projectName={projectName}
              workspaceLabel={workspaceLabel}
            />
          </div>
        )}

        <nav className={styles.bottomNav} aria-label="Studio tools">{RAIL.slice(0, 6).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => selectRail(id)} data-active={id === mode}><Icon size={16} /><span>{label}</span></button>)}</nav>
      </div>

      {/* Dedicated conversation column on the right.
          Controlled by mobileView when provided (parent is the single source of truth).
          Example: on mobile, only render conversation when mobileView === "chat". */}
      {(mobileView ? mobileView === "chat" : true) && showConversation && (
        <div className={styles.conversationPanel}>
          <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2 shrink-0">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ backgroundColor: terminalAgentColor ?? "#29e4ff" }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white truncate">{terminalAgentName ?? "LiTT"}</div>
              <div className="text-[9px] text-white/40 truncate">
                {activeAgentInfo?.role ?? "AI Assistant"}
                {projectName ? ` · ${projectName}` : ""}
              </div>
            </div>
            <span
              className="text-[9px] font-bold rounded px-1.5 py-0.5"
              style={{
                color: busyAgentId ? "#facc15" : "#43f59b",
                backgroundColor: busyAgentId ? "#facc1515" : "#43f59b15",
              }}
            >
              {busyAgentId ? "Working" : "Available"}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {conversation}
          </div>
        </div>
      )}
    </section>
  );
}
