"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Code2, Eye, FolderGit2, Play, RefreshCw } from "lucide-react";
import SystemTopologyPanel from "@/components/studio/SystemTopologyPanel";
import PreviewPanel from "@/components/studio/PreviewPanel";
import ProjectSourceSelector from "@/components/studio/ProjectSourceSelector";

interface StudioProject {
  id: string;
  name: string;
  slug: string;
  sourceType: string;
  framework: string | null;
  workspaceStatus: string;
  runtimeStatus: string;
  previewUrl: string | null;
}

interface ProjectListResponse {
  projects?: StudioProject[];
  legacyOnly?: StudioProject[];
  error?: string;
}

export default function BuilderTool() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("Create a branded landing page for a creative production system.");
  const [quality, setQuality] = useState<"draft" | "polished" | "cinematic">("polished");
  const [visualSource, setVisualSource] = useState<"auto" | "real-photos" | "ai-generated" | "project-assets">("auto");
  const [imageSource, setImageSource] = useState<"auto" | "stock" | "generated" | "uploaded">("auto");
  const [mockups, setMockups] = useState<"off" | "browser" | "mobile" | "multi-device">("browser");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | Record<string, unknown>>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const response = await fetch("/api/studio-projects", { cache: "no-store" });
      const payload = (await response.json()) as ProjectListResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load projects");
      }
      const all = [...(payload.projects ?? []), ...(payload.legacyOnly ?? [])];
      setProjects(all);
      // Auto-select the first project only if nothing is selected yet.
      // Uses a functional update so this callback doesn't depend on projectId.
      setProjectId((current) => current || all[0]?.id || "");
    } catch (loadError) {
      setProjectsError(loadError instanceof Error ? loadError.message : "Failed to load projects");
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projects, projectId],
  );

  const launchBuild = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/visual-builds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          quality,
          visualSource,
          imageSource,
          mockups,
          review: true,
          responsiveQA: true,
        }),
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(String(payload.error || "Visual build failed"));
      }
      setResult(payload);
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "Visual build failed");
    } finally {
      setLoading(false);
    }
  };

  const previewUrl = typeof result?.build === "object" && result.build && "summary" in result.build
    ? String((result.build as { summary?: Record<string, unknown> }).summary?.previewUrl || "")
    : selectedProject?.previewUrl || "";
  const buildStatus = typeof result?.build === "object" && result.build && "status" in result.build
    ? String((result.build as { status?: string }).status || "")
    : "";

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-3 overflow-auto">
      <SystemTopologyPanel />
      <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <div className="mb-4 flex items-center gap-2">
            <Code2 size={16} className="text-cyan-300" />
            <div>
              <p className="text-xs font-black uppercase tracking-wider">AI Studio</p>
              <p className="text-[10px] text-white/50">Prompt → assets → preview → review → repair</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              [FolderGit2, "Workspace", "Inspect and edit project files"],
              [Play, "Build", "Run the visual build pipeline"],
              [Eye, "Preview", "Open the live result"],
            ].map(([Icon, title, copy]) => {
              const I = Icon as typeof Code2;
              return (
                <div key={String(title)} className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                  <I size={15} className="mb-2 text-cyan-300" />
                  <p className="text-xs font-bold">{String(title)}</p>
                  <p className="mt-1 text-[10px] text-white/50">{String(copy)}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-xs text-white/70">
                <span className="flex items-center justify-between">
                  Project
                  <button
                    type="button"
                    onClick={() => void refreshProjects()}
                    className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70"
                  >
                    <RefreshCw size={10} /> Refresh
                  </button>
                </span>
                {projectsLoading ? (
                  <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/50">Loading projects…</div>
                ) : projects.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 bg-black/40 px-3 py-2 text-xs text-white/40">
                    {projectsError ? projectsError : "No projects yet — create one below."}
                  </div>
                ) : (
                  <select
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                    className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} ({project.sourceType})
                      </option>
                    ))}
                  </select>
                )}
                {selectedProject ? (
                  <span className="text-[10px] text-white/40">
                    {selectedProject.framework ?? "static"} · workspace {selectedProject.workspaceStatus}
                  </span>
                ) : null}
              </label>
              <label className="grid gap-1 text-xs text-white/70">
                Quality
                <select value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none">
                  <option value="draft">Draft</option>
                  <option value="polished">Polished</option>
                  <option value="cinematic">Cinematic</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-white/70">
                Visual Source
                <select value={visualSource} onChange={(event) => setVisualSource(event.target.value as typeof visualSource)} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none">
                  <option value="auto">Auto</option>
                  <option value="real-photos">Real Photos</option>
                  <option value="ai-generated">AI Generated</option>
                  <option value="project-assets">Project Assets</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-white/70">
                Image Source
                <select value={imageSource} onChange={(event) => setImageSource(event.target.value as typeof imageSource)} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none">
                  <option value="auto">Auto</option>
                  <option value="stock">Stock</option>
                  <option value="generated">Generated</option>
                  <option value="uploaded">Uploaded</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-white/70 md:col-span-2">
                Prompt
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none"
                />
              </label>
              <label className="grid gap-1 text-xs text-white/70">
                Mockups
                <select value={mockups} onChange={(event) => setMockups(event.target.value as typeof mockups)} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none">
                  <option value="off">Off</option>
                  <option value="browser">Browser</option>
                  <option value="mobile">Mobile</option>
                  <option value="multi-device">Multi-device</option>
                </select>
              </label>
            </div>
            <button
              onClick={launchBuild}
              disabled={loading || !projectId}
              className="inline-flex w-fit rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-xs font-bold text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Building…" : "Run visual build"}
            </button>
            {error ? <p className="text-xs text-red-300">{error}</p> : null}
            {result ? (
              <div className="grid gap-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/75">
                <p><strong>Status:</strong> {buildStatus || "unknown"}</p>
                <p><strong>Complete:</strong> {String(result.complete)}</p>
                <p><strong>Repair applied:</strong> {String(result.repairApplied)}</p>
                <p><strong>Review:</strong> {String((result.review as { verdict?: string } | undefined)?.verdict || "n/a")} / {String((result.review as { score?: number } | undefined)?.score ?? "n/a")}</p>
                <p><strong>Preview:</strong> {previewUrl || "not available yet"}</p>
                <p><strong>Changed files:</strong> {Array.isArray(result.changedFiles) ? result.changedFiles.length : 0}</p>
              </div>
            ) : null}
          </div>
        </section>
        <aside className="space-y-3">
          <PreviewPanel status={buildStatus} previewUrl={previewUrl || null} onRefresh={() => undefined} />
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">Project</p>
            <p className="mt-2 text-[10px] leading-relaxed text-white/55">Select a project source to start building.</p>
            <button
              onClick={() => {
                const evt = new CustomEvent("studio:switch-tool", {
                  detail: "code",
                });
                if (typeof window !== "undefined") {
                  window.dispatchEvent(evt);
                }
              }}
              className="mt-4 inline-flex rounded-lg border border-white/10 px-3 py-2 text-[10px] font-bold"
            >
              Open code workspace
            </button>
          </div>
        </aside>
      </div>
      <section className="rounded-2xl border border-white/10 bg-black/30 p-4">
        <div className="mb-4">
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">Project source</p>
          <h3 className="mt-1 text-sm font-black">Choose how to start your project</h3>
          <p className="mt-1 text-[10px] text-white/50">GitHub, upload, template, or blank — this is the real project source used by Studio.</p>
        </div>
        <ProjectSourceSelector />
      </section>
    </div>
  );
}
