"use client";

/**
 * Studio shell v2 — the Figma-like operating shell. DIRECTLY replaces the old
 * CommandStudio layout (Larry rejected the old layout outright; no feature
 * flag, no parallel old path).
 *
 * Desktop:  top bar → [workspace rail | center column (surface + docked LiTT
 *            deck) | inspector].
 * Mobile (390px, CSS-driven): top bar → content per bottom tab
 *            (Workspace | LiTT | Panels) → bottom tabs. The LiTT tab turns the
 *            deck into a bottom sheet; the Panels tab stacks the workspace
 *            over the inspector. No floating widgets anywhere.
 *
 * Providers (LiTTRuntime, VoiceSession) live here — they used to live inside
 * CommandStudio. Chat/execution logic is NOT rewritten here; it moved from
 * CommandStudio into the deck/surface components and the shell context.
 */

import { PanelsTopLeft, SquarePen, LayoutGrid } from "lucide-react";
import { LiTTRuntimeProvider } from "../context/LiTTRuntimeContext";
import { VoiceSessionProvider } from "../context/VoiceSessionContext";
import ProjectNameDialog from "../components/ProjectNameDialog";
import { StudioShellProvider, useStudioShell, type MobileTab } from "./StudioShellContext";
import { StudioTopBar } from "./StudioTopBar";
import { WorkspaceRail } from "./WorkspaceRail";
import { WorkspaceSurface } from "./WorkspaceSurface";
import { InspectorPanel } from "./InspectorPanel";
import { LittCommandDeck } from "./LittCommandDeck";

const MOBILE_TABS: { id: MobileTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: "workspace", label: "Workspace", icon: LayoutGrid },
  { id: "litt", label: "LiTT", icon: SquarePen },
  { id: "panels", label: "Panels", icon: PanelsTopLeft },
];

function MobileTabBar() {
  const { mobileTab, setMobileTab } = useStudioShell();
  return (
    <nav
      className="flex shrink-0 items-stretch border-t md:hidden"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      aria-label="Studio sections"
    >
      {MOBILE_TABS.map(({ id, label, icon: Icon }) => {
        const active = mobileTab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setMobileTab(id)}
            aria-current={active ? "page" : undefined}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-bold"
            style={{ color: active ? "var(--litt-primary)" : "var(--text-muted)" }}
          >
            <Icon size={18} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function DesktopLayout() {
  return (
    <div className="hidden min-h-0 flex-1 md:flex" data-testid="studio-shell-desktop">
      <WorkspaceRail />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkspaceSurface />
        </div>
        <LittCommandDeck />
      </div>
      <InspectorPanel />
    </div>
  );
}

function MobileLayout() {
  const { mobileTab, deckExpanded, setDeckExpanded } = useStudioShell();
  return (
    <div className="flex min-h-0 flex-1 flex-col md:hidden" data-testid="studio-shell-mobile">
      {mobileTab === "workspace" && (
        <div className="flex min-h-0 flex-1">
          <WorkspaceRail />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <WorkspaceSurface />
          </div>
        </div>
      )}
      {mobileTab === "litt" && (
        <div className="flex min-h-0 flex-1 flex-col justify-end">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!deckExpanded && (
              <button
                type="button"
                onClick={() => setDeckExpanded(true)}
                className="mx-3 mt-3 rounded-xl border px-3 py-2.5 text-xs font-bold"
                style={{ borderColor: "var(--studio-border)", color: "var(--litt-primary)" }}
              >
                Show conversation
              </button>
            )}
          </div>
          <LittCommandDeck />
        </div>
      )}
      {mobileTab === "panels" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <WorkspaceSurface />
          </div>
          <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto">
            <InspectorPanel fillWidth />
          </div>
        </div>
      )}
      <MobileTabBar />
    </div>
  );
}

function ShellChrome() {
  const {
    projectNameDialogOpen,
    setProjectNameDialogOpen,
    creatingProject,
    projectCreateError,
    startBlankProject,
  } = useStudioShell();
  return (
    <div
      className="studio-shell flex h-full min-h-0 flex-col overflow-hidden"
      data-studio-chrome
      style={{ backgroundColor: "var(--studio-surface)" }}
      data-testid="studio-shell"
    >
      <StudioTopBar />
      <DesktopLayout />
      <MobileLayout />
      <ProjectNameDialog
        open={projectNameDialogOpen}
        busy={creatingProject}
        error={projectCreateError}
        onCancel={() => { if (!creatingProject) setProjectNameDialogOpen(false); }}
        onSubmit={(name) => { void startBlankProject(name); }}
      />
    </div>
  );
}

export function StudioShell() {
  return (
    <LiTTRuntimeProvider>
      <VoiceSessionProvider>
        <StudioShellProvider>
          <ShellChrome />
        </StudioShellProvider>
      </VoiceSessionProvider>
    </LiTTRuntimeProvider>
  );
}
