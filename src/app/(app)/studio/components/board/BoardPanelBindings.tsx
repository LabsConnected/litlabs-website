"use client";

/**
 * Board panel bindings (plan §2 B3) — the real systems behind the board.
 *
 * StudioBoard's `renderPanel` hook lands here. Every binding renders the
 * SAME component with the SAME props and handlers the fixed stage layout
 * uses (the compositions mirror CommandStudio's stage surfaces exactly):
 *
 *   preview   → StudioPreviewPanel (the live active project)
 *   code      → CodeWorkspace (Monaco surface on the project files API)
 *   files     → the single projectFilesContent element — the SAME
 *               StudioProjectFiles instance definition as the chat-panel
 *               Files tab. CommandStudio relocates it: while the board
 *               is active the LiTT panel does NOT receive it, so exactly
 *               one StudioProjectFiles instance exists at any time
 *               (Larry's single-Files-home rule, PR #976).
 *   terminal  → StudioTerminalDrawer (sandbox exec + terminal surface;
 *               the interactive sandbox PTY is its own lane, D1)
 *   health    → StudioHealthPanel, checks mode
 *   inspector → ElementInspectorPanel while a preview element is
 *               selected (the Preview→Inspector link: both sides read
 *               CommandStudio's one previewSelection state), otherwise
 *               the StudioInspector tab set (Plan/Changes/Checks/…)
 *   deploy    → StudioDeploySurface (the real deploy request path)
 *
 *   media / world → honest slots. Later slices — no fake systems.
 */

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useTheme } from "@/context/ThemeContext";
import type { DeployTargetChoice } from "@/lib/deployments/deploy-targets";
import type { ConnectionCapabilities } from "../../hooks/useConnectionSummary";
import type { InspectorTab } from "../../lib/studio-destinations";
import { useBoardLayoutStore } from "../../stores/useBoardLayoutStore";
import type { PreviewSelection } from "../StudioPreviewPanel";
import type { StudioSelectionPayload } from "../studioSelectionPayload";
import StudioHealthPanel from "../StudioHealthPanel";
import { StudioInspector, type StudioInspectorData } from "../StudioWorkspaceFrame";
import StudioDeploySurface from "../shell/StudioDeploySurface";
import ElementInspectorPanel from "../shell/ElementInspectorPanel";
import { boardDefinition, boardScopeKey, type BoardPanelId } from "./board-types";

const StudioPreviewPanel = dynamic(() => import("../StudioPreviewPanel"), { ssr: false });
const CodeWorkspace = dynamic(() => import("../code/CodeWorkspace").then((m) => m.CodeWorkspace), { ssr: false });
const StudioTerminalDrawer = dynamic(() => import("../StudioTerminalDrawer"), { ssr: false });

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
  workspaceRevision: number;
  healthRunTrigger: number;
  /** Inspector: the live preview/builder selection, if any. */
  previewSelection: PreviewSelection | StudioSelectionPayload | null;
  /** True when the selection is a live preview element (mirrors the
   *  shell ContextInspector's editor-slot condition). */
  showElementInspector: boolean;
  onAskAboutSelection: () => void;
  onClearSelection: () => void;
  inspectorTab: InspectorTab;
  onInspectorTabChange: (tab: InspectorTab) => void;
  inspectorData: StudioInspectorData;
  /** The canonical deploy request path (ask-litt + approval gate). */
  onDeployRequest: (target: DeployTargetChoice) => void;
}

export default function BoardPanelBindings(props: BoardPanelBindingsProps) {
  const { tokens } = useTheme();
  const { id, capabilities } = props;
  const projectId = capabilities.projectId;

  switch (id) {
    case "preview":
      // The SAME StudioPreviewPanel + props as the Preview stage and the
      // dockable preview panel — no second preview implementation.
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-preview">
          <StudioPreviewPanel
            projectId={projectId}
            projectName={capabilities.projectName}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch}
            sourceKind={capabilities.sourceKind}
            sourceStatus={capabilities.sourceStatus}
            versionControl={capabilities.versionControl}
            workspaceStatus={capabilities.workspaceStatus ?? null}
            lastRunFailureNote={props.lastRunFailureNote}
            onSelectionChange={props.onPreviewSelectionChange}
          />
        </div>
      );
    case "code":
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-code">
          <CodeWorkspace
            projectId={projectId}
            repositoryName={capabilities.repositoryName}
            branch={capabilities.activeBranch}
            workspaceStatus={capabilities.workspaceStatus ?? null}
            writeAccess={capabilities.writeAccess ?? true}
          />
        </div>
      );
    case "files":
      // Relocated single instance — see the header note. The element is
      // CommandStudio's projectFilesContent, unchanged.
      return <div className="h-full min-h-0" data-testid="board-binding-files">{props.filesContent}</div>;
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
          <StudioHealthPanel
            mode="checks"
            projectId={projectId}
            refreshKey={props.workspaceRevision}
            runTrigger={props.healthRunTrigger}
          />
        </div>
      );
    case "inspector":
      // Preview→Inspector link: a live preview selection swaps the tab
      // set for the real element editor — the same precedence the shell
      // ContextInspector applies (editor slot wins over default content).
      if (props.showElementInspector && props.previewSelection) {
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-inspector">
            <ElementInspectorPanel
              selection={props.previewSelection}
              projectId={projectId}
              route={null}
              onAskAboutSelection={props.onAskAboutSelection}
              onClearSelection={props.onClearSelection}
            />
          </div>
        );
      }
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-inspector">
          <StudioInspector
            embedded
            open
            onToggle={() =>
              useBoardLayoutStore
                .getState()
                .closePanel(boardScopeKey(props.userId, props.projectId), "inspector")
            }
            activeTab={props.inspectorTab}
            onTabChange={props.onInspectorTabChange}
            data={props.inspectorData}
          />
        </div>
      );
    case "deploy":
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="board-binding-deploy">
          <StudioDeploySurface projectId={projectId} onDeployRequest={props.onDeployRequest} />
        </div>
      );
    case "media":
    case "world":
      // Later slices (Media panel build / World panel v1) — honest slot,
      // identical to the unbound B2 slot. No fake system is rendered.
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
      return null;
  }
}
