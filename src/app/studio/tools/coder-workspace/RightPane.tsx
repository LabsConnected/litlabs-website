/**
 * RightPane — Files | Code | Preview | Review tabs.
 *
 * Reads from existing /api/studio-projects/[id]/files and /preview endpoints.
 * Code and Review tabs show truthful "not yet" states.
 */

import { useState } from "react";
import { useFilesData, usePreviewData } from "./hooks";
import { EmptyState, ErrorState, LoadingState } from "./StateViews";
import type { StudioProject } from "./types";

interface ThemeColors {
  borderColor: string;
}

type RightTab = "files" | "code" | "preview" | "review";

export function RightPane({
  projectId,
  project,
  T,
}: {
  projectId: string;
  project: StudioProject | null;
  T: ThemeColors;
}) {
  const [tab, setTab] = useState<RightTab>("files");
  const { files, status: filesStatus, error: filesError } = useFilesData(projectId);
  const { previewUrl, status: previewStatus, error: previewError } =
    usePreviewData(projectId);

  const tabs: { id: RightTab; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "code", label: "Code" },
    { id: "preview", label: "Preview" },
    { id: "review", label: "Review" },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: `${T.borderColor}30` }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition ${
              tab === t.id
                ? "bg-white/10 text-white"
                : "text-white/40 hover:text-white/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        {!projectId ? (
          <EmptyState
            title="No project selected"
            body="Select a project above, or create one from the Build tool. Files, code, preview, and review will appear here."
          />
        ) : tab === "files" ? (
          <FilesTab
            files={files}
            status={filesStatus}
            error={filesError}
          />
        ) : tab === "code" ? (
          <EmptyState
            title="Code viewer"
            body="Select a file from the Files tab to view its contents. File editing arrives in Phase 3 with structured workspace tools."
          />
        ) : tab === "preview" ? (
          <PreviewTab
            previewUrl={previewUrl}
            status={previewStatus}
            error={previewError}
            project={project}
          />
        ) : tab === "review" ? (
          <EmptyState
            title="Visual review"
            body="Deterministic browser QA and multimodal design review arrive in Phase 6. No review has been run yet."
          />
        ) : null}
      </div>
    </div>
  );
}

function FilesTab({
  files,
  status,
  error,
}: {
  files: { name: string; path: string; type: string; size?: number }[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}) {
  if (status === "loading") return <LoadingState label="Loading file tree…" />;
  if (status === "error") return <ErrorState message={error ?? "Failed to load files"} />;
  if (files.length === 0)
    return (
      <EmptyState
        title="Empty workspace"
        body="The project workspace has no files yet, or the workspace is not prepared."
      />
    );
  return (
    <ul className="py-1 text-[11px]">
      {files.map((f) => (
        <li
          key={f.path}
          className="flex items-center gap-2 px-3 py-0.5 hover:bg-white/5"
        >
          <span className="text-white/40">
            {f.type === "directory" ? "▸" : "·"}
          </span>
          <span className="text-white/70">{f.name}</span>
          {f.size != null && (
            <span className="ml-auto text-[9px] text-white/30">{f.size} B</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PreviewTab({
  previewUrl,
  status,
  error,
  project,
}: {
  previewUrl: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  project: StudioProject | null;
}) {
  if (status === "loading") return <LoadingState label="Loading preview status…" />;
  if (status === "error") return <ErrorState message={error ?? "Preview unavailable"} />;
  if (!previewUrl)
    return (
      <EmptyState
        title="No preview"
        body={
          project?.runtimeStatus === "ready"
            ? "Runtime reports ready but no preview URL is set."
            : "The project runtime is not running. Start it from the Build tool or terminal."
        }
      />
    );
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1">
        <span className="truncate text-[10px] text-white/50">{previewUrl}</span>
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[10px] text-cyan-300 hover:underline"
        >
          Open ↗
        </a>
      </div>
      <iframe
        src={previewUrl}
        className="min-h-0 flex-1 border-0 bg-white"
        title="Project preview"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}
