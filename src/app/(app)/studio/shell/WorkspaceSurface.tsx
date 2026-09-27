"use client";

/**
 * Studio shell workspace surface — the canvas area.
 *
 * Design (the default workspace) mounts the REAL StudioPreviewPanel with its
 * click-to-select bridge, wired to the shell's one selection model. Images
 * mounts the REAL image/video generator tools when a media intent arrives
 * (the chat promises "Opening the image generator", so the real tool must
 * open). Activity hosts the real StudioHealthPanel when a checks/approvals
 * intent requests it. Every other workspace is an honest Phase-2
 * placeholder: no fake preview, no decorative buttons.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import StudioPreviewPanel from "../components/StudioPreviewPanel";
import StudioHealthPanel from "../components/StudioHealthPanel";
import { useStudioShell, type MediaRequest, type WorkspaceId } from "./StudioShellContext";

const ImageTool = dynamic(() => import("../tools/ImageTool"), { ssr: false });
const VideoTool = dynamic(() => import("../tools/VideoTool"), { ssr: false });

function PhaseTwoPlaceholder({ workspace }: { workspace: WorkspaceId }) {
  const copy: Record<WorkspaceId, { title: string; blurb: string }> = {
    design: { title: "", blurb: "" },
    browser: {
      title: "Browser workspace",
      blurb: "Live browser sessions and visual checks will open here in Phase 2.",
    },
    images: {
      title: "Images workspace",
      blurb: "Ask LiTT to generate an image or video — the generator will open here.",
    },
    code: {
      title: "Code workspace",
      blurb: "File editing and diffs will live here in Phase 2.",
    },
    files: {
      title: "Files workspace",
      blurb: "The project file tree will live here in Phase 2.",
    },
    assets: {
      title: "Assets workspace",
      blurb: "Brand assets and uploads will live here in Phase 2.",
    },
    deploy: {
      title: "Deploy workspace",
      blurb: "Publish controls and deployment status will live here in Phase 2.",
    },
    activity: {
      title: "Activity workspace",
      blurb: "The full execution timeline will live here in Phase 2. Live activity already shows in the command deck.",
    },
  };
  const { title, blurb } = copy[workspace];
  if (!title) return null;
  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="studio-workspace-placeholder">
      <div className="max-w-sm text-center">
        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {blurb}
        </p>
      </div>
    </div>
  );
}

function MediaGenerator({ request, onClose }: { request: MediaRequest; onClose: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="studio-workspace-media">
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b px-3"
        style={{ borderColor: "var(--studio-border)" }}
      >
        <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-secondary)" }}>
          {request.kind === "image" ? "Image generator" : "Video generator"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-[11px] font-bold hover:bg-white/8"
          style={{ color: "var(--text-muted)" }}
          aria-label="Close generator"
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {request.kind === "image" ? (
          <ImageTool key={request.prompt} initialPrompt={request.prompt} />
        ) : (
          <VideoTool key={request.prompt} initialPrompt={request.prompt} />
        )}
      </div>
    </div>
  );
}

function ActivitySurface() {
  const { capabilities, healthPanel } = useStudioShell();
  if (!healthPanel) return <PhaseTwoPlaceholder workspace="activity" />;
  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="studio-workspace-health">
      <StudioHealthPanel
        mode={healthPanel.mode}
        projectId={capabilities.projectId ?? null}
        runTrigger={healthPanel.runTrigger}
      />
    </div>
  );
}

export function WorkspaceSurface() {
  const { workspace, capabilities, setSelection, mediaRequest, clearMediaRequest } = useStudioShell();
  const { userId } = useClerkAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  // Refresh the preview after assistant-driven file changes.
  useEffect(() => {
    const onFilesChanged = () => setRefreshKey((k) => k + 1);
    window.addEventListener("studio:files-changed", onFilesChanged);
    return () => window.removeEventListener("studio:files-changed", onFilesChanged);
  }, []);

  const handleSelectionChange = useCallback(
    (previewSelection: { label: string; selector: string; tagName: string } | null) => {
      if (!previewSelection) {
        setSelection(null);
        return;
      }
      setSelection({
        workspace: "design",
        kind: "element",
        ref: previewSelection.selector,
        label: previewSelection.label,
        tagName: previewSelection.tagName,
      });
    },
    [setSelection],
  );

  if (workspace === "images") {
    return mediaRequest ? (
      <MediaGenerator request={mediaRequest} onClose={clearMediaRequest} />
    ) : (
      <PhaseTwoPlaceholder workspace="images" />
    );
  }

  if (workspace === "activity") return <ActivitySurface />;

  if (workspace !== "design") return <PhaseTwoPlaceholder workspace={workspace} />;

  const projectId = capabilities.projectId ?? "";
  if (!projectId || !userId) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Connect a project to see the live preview.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0" data-testid="studio-workspace-design">
      <StudioPreviewPanel
        projectId={projectId}
        projectName={capabilities.projectName ?? "Project"}
        repositoryName={capabilities.repositoryName}
        branch={capabilities.activeBranch ?? capabilities.defaultBranch ?? null}
        workspaceStatus={capabilities.workspaceStatus ?? null}
        sourceKind={capabilities.sourceKind ?? null}
        sourceStatus={capabilities.sourceStatus ?? null}
        versionControl={capabilities.versionControl ?? "none"}
        refreshKey={refreshKey}
        onSelectionChange={handleSelectionChange}
      />
    </div>
  );
}
