"use client";

/**
 * Board panel bindings (plan §2 B3) — the real systems behind the board.
 *
 * StudioBoard's `renderPanel` hook lands here. Every binding renders the
 * SAME component with the SAME props and handlers the fixed stage layout
 * uses:
 *
 *   preview   → the single previewContent element built by
 *               CommandStudio (ONE StudioPreviewPanel instance, with
 *               the full board prop set). Relocated, never duplicated:
 *               when the Code box is the preview's home, this panel
 *               renders a pointer card instead (mapping §1).
 *   code      → CodeWorkspace (Monaco surface on the project files
 *               API) — the one box: Explorer + editor + the shared
 *               preview region side by side, plus Plan and
 *               Canvas / Design as internal Code-box views
 *               (spec Amendment 4). The standalone plan / canvas board
 *               panels are retired — those surfaces live in Code now.
 *   files     → the single projectFilesContent element — the SAME
 *               StudioProjectFiles instance definition as the chat-panel
 *               Files tab. CommandStudio relocates it: while the board
 *               is active the LiTT panel does NOT receive it, so exactly
 *               one StudioProjectFiles instance exists at any time
 *               (Larry's single-Files-home rule, PR #976).
 *   terminal  → StudioTerminalDrawer (sandbox exec + terminal surface;
 *               the interactive sandbox PTY is its own lane, D1)
 *   health    → StudioHealthPanel, checks mode
 *   deploy    → StudioDeploySurface (the real deploy request path)
 *
 * Board-only rebuild additions (2026-11-14):
 *   chat      → BoardChatPanel (Command Center chrome around the real
 *               transcript + composer, built by CommandStudio)
 *   activity  → StudioActivityPanel + MissionCards — Activity's own
 *               board panel, never a chat tab
 *   media     → BoardMediaPanel (Asset Lake: images / video / music)
 *   browser   → BoardBrowserPanel (embedded web view)
 *
 * Retired (Studio layout build, 2026-11-17):
 *   inspector → the Inspector window is retired. Its keepers
 *               (approvals / changes / plans) live in the chat panel's
 *               Jobs tab (another lane); there is no board binding.
 *   plan      → StudioPlanSurface lives inside the Code box now.
 *   canvas    → the Canvas & Design stage lives inside the Code box.
 *
 *   world → honest slot. Later slice — no fake system.
 */

import dynamic from "next/dynamic";
import { useSyncExternalStore, type ReactNode } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { DeployTargetChoice } from "@/lib/deployments/deploy-targets";
import type { ConnectionCapabilities } from "../../hooks/useConnectionSummary";
import type { InspectorTab } from "../../lib/studio-destinations";
import type { PreviewSelection } from "../StudioPreviewPanel";
import type { StudioSelectionPayload } from "../studioSelectionPayload";
import StudioHealthPanel from "../StudioHealthPanel";
import { StudioActivityPanel, type StudioInspectorData } from "../StudioWorkspaceFrame";
import StudioDeploySurface from "../shell/StudioDeploySurface";
import MissionCards from "../MissionCards";
import BoardMediaPanel from "./BoardMediaPanel";
import BoardBrowserPanel from "./BoardBrowserPanel";
import WorkspaceBanner from "./WorkspaceBanner";
import { boardDefinition, type BoardPanelId } from "./board-types";

const CodeWorkspace = dynamic(() => import("../code/CodeWorkspace").then((m) => m.CodeWorkspace), { ssr: false });
const StudioTerminalDrawer = dynamic(() => import("../StudioTerminalDrawer"), { ssr: false });

// ── Preview home coordination ─────────────────────────────────────
// The live preview runs in exactly ONE home at a time (spec §1): the
// standalone Preview panel or the Code box's preview region. Every
// board panel is a separate BoardPanelBindings instance, so the home
// is kept in a tiny module-level store all instances subscribe to —
// the same element is never rendered by two homes at once. Default
// home is the standalone Preview panel (its historical home).

export type BoardPreviewHome = "preview" | "code";

let previewHome: BoardPreviewHome = "preview";
const previewHomeListeners = new Set<() => void>();

export function getBoardPreviewHome(): BoardPreviewHome {
  return previewHome;
}

export function setBoardPreviewHome(home: BoardPreviewHome): void {
  if (previewHome === home) return;
  previewHome = home;
  for (const listener of previewHomeListeners) listener();
}

/** Test hook — resets the shared preview home to its default. */
export function resetBoardPreviewHome(): void {
  setBoardPreviewHome("preview");
}

function subscribePreviewHome(listener: () => void): () => void {
  previewHomeListeners.add(listener);
  return () => {
    previewHomeListeners.delete(listener);
  };
}

function useBoardPreviewHome(): BoardPreviewHome {
  return useSyncExternalStore(subscribePreviewHome, getBoardPreviewHome, getBoardPreviewHome);
}

// ── Pointer card ──────────────────────────────────────────────────
// The honest placeholder shown by the home that does NOT currently
// hold the live preview (the pointer-card pattern from mapping §1,
// implemented fresh here). No fake preview, no second session.

function PreviewPointerCard({
  message,
  actionLabel,
  onAction,
  testId,
}: {
  message: string;
  actionLabel: string;
  onAction: () => void;
  testId: string;
}) {
  const { tokens } = useTheme();
  return (
    <div
      data-testid={testId}
      className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center"
    >
      <span className="text-xs font-bold" style={{ color: tokens.text }}>
        {message}
      </span>
      <span className="max-w-sm text-[11px] leading-5" style={{ color: tokens.textMuted }}>
        The live preview runs in one place at a time so there is only ever one preview session.
      </span>
      <button
        type="button"
        onClick={onAction}
        className="mt-1 min-h-8 rounded-md border px-3 text-xs font-bold"
        style={{ borderColor: "var(--studio-border)", color: tokens.text }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

export interface BoardPanelBindingsProps {
  id: BoardPanelId;
  /** Board scope identity (layout store + inspector close action). */
  userId: string;
  projectId: string;
  capabilities: ConnectionCapabilities;
  lastRunFailureNote: string | null;
  /** Same selection sink the Preview stage uses — one shared state, so a
   *  selection in the board Preview reflects in the board Inspector. */
  onPreviewSelectionChange: (sel: PreviewSelection | null) => void;
  /** The single Files element (header + StudioProjectFiles), relocated
   *  from the chat panel while the board is active. */
  filesContent: ReactNode;
  /**
   * The single Preview element (StudioPreviewPanel with the board
   * binding's full prop set), built once by CommandStudio and
   * relocated between the Preview panel and the Code box — exactly
   * one home renders it at a time (see the preview-home store above).
   */
  previewContent?: ReactNode;
  /** Bump the shared preview element's refreshKey (CodeWorkspace's
   *  save path, re-threaded through CommandStudio). */
  onPreviewRefreshRequest?: () => void;
  workspaceRevision: number;
  healthRunTrigger: number;
  /** Inspector: the live preview/builder selection, if any.
   *  @deprecated The board Inspector panel is retired; kept optional
   *  so in-flight callers from other lanes still compile. */
  previewSelection?: PreviewSelection | StudioSelectionPayload | null;
  /** @deprecated Retired with the board Inspector panel. */
  showElementInspector?: boolean;
  /** @deprecated Retired with the board Inspector panel. */
  onAskAboutSelection?: () => void;
  /** @deprecated Retired with the board Inspector panel. */
  onClearSelection?: () => void;
  /** @deprecated Retired with the board Inspector panel. */
  inspectorTab?: InspectorTab;
  /** @deprecated Retired with the board Inspector panel. */
  onInspectorTabChange?: (tab: InspectorTab) => void;
  /** @deprecated Retired with the board Inspector panel. */
  inspectorData?: StudioInspectorData;
  /** The canonical deploy request path (ask-litt + approval gate). */
  onDeployRequest: (target: DeployTargetChoice) => void;
  /** The BoardChatPanel element (Command Center), built by CommandStudio. */
  chatContent: ReactNode;
  /** The Canvas & Design stage element, built by CommandStudio.
   *  Threaded into CodeWorkspace (Canvas / Design lives in Code now). */
  canvasContent: ReactNode;
  /** Summon (open / restore / focus) a board panel — the board-only
   *  replacement for stage jumps in Plan / MissionCards actions. */
  summonPanel: (id: BoardPanelId) => void;
  /** Activity panel data (mirrors the stage Activity surface's props). */
  activityRunId: string | null;
  activityBusy: boolean;
  activityModelLabel: string;
  activityTerminalStatus: string;
  /** Real rollback (restore_checkpoint), shared with Plan/MissionCards. */
  onRollback: () => void;
}

export default function BoardPanelBindings(props: BoardPanelBindingsProps) {
  const { tokens } = useTheme();
  const { id, capabilities } = props;
  const projectId = capabilities.projectId;
  const previewHomeNow = useBoardPreviewHome();

  const summon = props.summonPanel;
  // Workspace banner (Kimi wiring item 6): rendered INSIDE the panels
  // that depend on the workspace (preview / health / files / code /
  // browser) — never globally. Driven by the capabilities' real
  // workspace status; Reconnect runs the real prepare POST inside the
  // banner; View logs summons the Terminal / Logs panel.
  const workspaceBanner = (
    <WorkspaceBanner
      projectId={projectId}
      workspaceStatus={capabilities.workspaceStatus ?? null}
      onViewLogs={() => summon("terminal")}
    />
  );
  const missionCards = (
    <MissionCards
      capabilities={capabilities}
      modelLabel={props.activityModelLabel}
      onOpenCode={() => summon("code")}
      onOpenCanvas={() => summon("code")}
      onOpenPreview={() => summon("preview")}
      onOpenTerminal={() => summon("terminal")}
      onOpenActivity={() => summon("activity")}
      onOpenFiles={() => summon("files")}
      onRollback={props.onRollback}
    />
  );

  switch (id) {
    case "chat":
      return (
        <div className="h-full min-h-0" data-testid="board-binding-chat">
          {props.chatContent}
        </div>
      );
    case "activity":
      return (
        <div className="h-full min-h-0 overflow-y-auto" data-testid="board-binding-activity">
          <StudioActivityPanel
            runId={props.activityRunId}
            busy={props.activityBusy}
            modelLabel={props.activityModelLabel}
            projectName={capabilities.projectName}
            terminalStatus={props.activityTerminalStatus}
            missionContent={missionCards}
          />
        </div>
      );
    case "media":
      return (
        <div className="h-full min-h-0" data-testid="board-binding-media">
          <BoardMediaPanel projectId={projectId} />
        </div>
      );
    case "browser":
      return (
        <div className="flex h-full min-h-0 flex-col" data-testid="board-binding-browser">
          {workspaceBanner}
          <div className="min-h-0 flex-1">
            <BoardBrowserPanel />
          </div>
        </div>
      );
    case "preview":
      // The ONE shared preview element — rendered here only while the
      // Preview panel is the preview's home. When the Code box shows
      // the preview, this panel shows the honest pointer card instead.
      if (previewHomeNow !== "preview") {
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-preview">
            <PreviewPointerCard
              testId="board-preview-pointer-to-code"
              message="Preview is showing in the Code panel"
              actionLabel="Bring preview here"
              onAction={() => setBoardPreviewHome("preview")}
            />
          </div>
        );
      }
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-preview">
          {workspaceBanner}
          <div className="flex min-h-0 flex-1 flex-col">
            {props.previewContent}
          </div>
        </div>
      );
    case "code": {
      // The one box: CodeWorkspace receives the shared preview element
      // only while Code is the preview's home; otherwise its preview
      // region renders the reverse pointer card (its button brings the
      // preview's home here, into the Code box).
      const inCode = previewHomeNow === "code";
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-code">
          {workspaceBanner}
          <div className="flex min-h-0 flex-1 flex-col">
            <CodeWorkspace
              projectId={projectId}
              repositoryName={capabilities.repositoryName}
              branch={capabilities.activeBranch}
              workspaceStatus={capabilities.workspaceStatus ?? null}
              writeAccess={capabilities.writeAccess ?? true}
              previewContent={inCode ? props.previewContent : undefined}
              previewPlaceholder={
                inCode ? undefined : (
                  <PreviewPointerCard
                    testId="code-preview-pointer-to-preview"
                    message="Preview is showing in the Static View panel"
                    actionLabel="Bring preview here"
                    onAction={() => setBoardPreviewHome("code")}
                  />
                )
              }
              canvasContent={props.canvasContent}
              planCapabilities={capabilities}
              planModelLabel={props.activityModelLabel}
              onPreviewRefreshRequest={props.onPreviewRefreshRequest}
              onSummonPanel={(panelId) => summon(panelId as BoardPanelId)}
              onRollback={props.onRollback}
            />
          </div>
        </div>
      );
    }
    case "files":
      // Relocated single instance — see the header note. The element is
      // CommandStudio's projectFilesContent, unchanged.
      return (
        <div className="flex h-full min-h-0 flex-col" data-testid="board-binding-files">
          {workspaceBanner}
          <div className="min-h-0 flex-1">{props.filesContent}</div>
        </div>
      );
    case "terminal":
      // renderPanel only runs for open, non-minimized panels, so the
      // drawer is visible whenever it is mounted on the board.
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-terminal">
          <StudioTerminalDrawer
            projectId={projectId}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch ?? capabilities.defaultBranch}
            visible
          />
        </div>
      );
    case "health":
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-health">
          {workspaceBanner}
          <StudioHealthPanel
            mode="checks"
            projectId={projectId}
            refreshKey={props.workspaceRevision}
            runTrigger={props.healthRunTrigger}
          />
        </div>
      );
    case "deploy":
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-deploy">
          <StudioDeploySurface projectId={projectId} onDeployRequest={props.onDeployRequest} />
        </div>
      );
    case "world":
      // Later slice (World panel v1) — honest slot, identical to the
      // unbound B2 slot. No fake system is rendered.
      return (
        <div
          data-testid={`board-panel-slot-${id}`}
          className="flex h-full items-center justify-center p-4 text-center text-xs"
          style={{ color: tokens.textMuted }}
        >
          {boardDefinition(id).bindingNote}
        </div>
      );
    default:
      // Retired panels (inspector / plan / canvas) have no binding —
      // their surfaces live in the chat panel's Jobs tab and inside
      // the Code box respectively. The board-core lane removes them
      // from the panel inventory.
      return null;
  }
}
