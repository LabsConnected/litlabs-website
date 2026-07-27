"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Code2,
  Database,
  Eye,
  FolderGit2,
  Globe2,
  HardDriveUpload,
  Layers,
  Link2,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { StudioTool } from "./StudioSidebar";

type SourceOption = {
  id: string;
  label: string;
  detail: string;
  icon: typeof FolderGit2;
  available: boolean;
  href?: string;
};

type SourceCategory = {
  name: string;
  icon: typeof FolderGit2;
  options: SourceOption[];
};

const SOURCE_CATEGORIES: SourceCategory[] = [
  {
    name: "Code",
    icon: Code2,
    options: [
      { id: "github", label: "GitHub Repository", detail: "GitHub App · repositories and branches", icon: FolderGit2, available: true, href: "/studio/github" },
      { id: "git-url", label: "Paste Git URL", detail: "Continue in Chat with a public repository URL", icon: Link2, available: true },
      { id: "gitlab", label: "GitLab", detail: "OAuth repository connection", icon: FolderGit2, available: false },
      { id: "bitbucket", label: "Bitbucket", detail: "Atlassian repository connection", icon: FolderGit2, available: false },
      { id: "azure-devops", label: "Azure DevOps", detail: "Microsoft repository connection", icon: Code2, available: false },
      { id: "upload-project", label: "Upload ZIP or Folder", detail: "Bring an existing local project", icon: HardDriveUpload, available: false },
    ],
  },
  {
    name: "Design",
    icon: Layers,
    options: [
      { id: "website", label: "Website URL", detail: "Continue in Chat with a website URL to inspect", icon: Globe2, available: true },
      { id: "figma", label: "Figma Design", detail: "Screens, components, styles, and tokens", icon: Layers, available: false },
    ],
  },
  {
    name: "Documents",
    icon: HardDriveUpload,
    options: [
      { id: "upload-files", label: "Upload Files", detail: "PDFs, images, code, documents, ZIP files", icon: HardDriveUpload, available: false },
      { id: "google-drive", label: "Google Drive", detail: "Docs, project files, brand material", icon: HardDriveUpload, available: false },
    ],
  },
  {
    name: "Infrastructure",
    icon: Database,
    options: [
      { id: "api-database", label: "API or Database", detail: "OpenAPI, Supabase, schema, or endpoint", icon: Database, available: false },
      { id: "deployment", label: "Existing Deployment", detail: "Vercel or live-site configuration", icon: Rocket, available: false },
    ],
  },
];

const PERMISSION_MODES = [
  { id: "scan", label: "Scan Only", icon: Eye, description: "Read files and analyze. No writes.", default: true },
  { id: "approval", label: "Approval Mode", icon: ShieldCheck, description: "Propose changes. You approve every write.", default: false },
  { id: "agent", label: "Agent Mode", icon: Zap, description: "Create branches, commit, and open merge requests.", default: false },
] as const;

export default function StudioOnboarding({
  onToolChange,
  onStartBlank,
}: {
  onToolChange: (tool: StudioTool) => void;
  onStartBlank?: () => Promise<void> | void;
}) {
  const { resolvedColors: T } = useTheme();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(0);
  const [showMoreProviders, setShowMoreProviders] = useState(false);
  const [permissionMode, setPermissionMode] = useState<string>("scan");
  const [sourceInput, setSourceInput] = useState("");
  const [inputSource, setInputSource] = useState<"git-url" | "website" | null>(null);
  const templates = ["Landing Page", "Dashboard", "SaaS App", "Portfolio", "Store", "Custom"];

  // First 4 common providers for the quick grid
  const codeCategory = SOURCE_CATEGORIES[0];
  const quickProviders = codeCategory.options.slice(0, 2); // GitHub + Paste Git URL

  const continueWithSource = () => {
    const value = sourceInput.trim();
    if (!inputSource || !value) return;
    const mission = inputSource === "git-url"
      ? `Inspect this Git repository in ${permissionMode} mode and set up the project: ${value}`
      : `Scan this website in ${permissionMode} mode and create a project plan: ${value}`;
    window.localStorage.setItem("litt:source-permission-mode", permissionMode);
    window.location.href = `/studio?tool=chat&source=${inputSource}&permission=${permissionMode}&mission=${encodeURIComponent(mission)}`;
  };

  const sourceCard = (source: SourceOption) => {
    if (source.available && source.href) {
      const separator = source.href.includes("?") ? "&" : "?";
      return (
        <Link
          key={source.id}
          href={`${source.href}${separator}permission=${permissionMode}`}
          className="rounded-2xl border border-cyan-300/15 bg-cyan-300/4 p-4 transition hover:border-cyan-300/35 hover:bg-cyan-300/[.07]"
        >
          <SourceCard source={source} />
        </Link>
      );
    }
    if (source.available && (source.id === "git-url" || source.id === "website")) {
      return (
        <button
          key={source.id}
          onClick={() => {
            setInputSource(source.id as "git-url" | "website");
            setSourceInput("");
          }}
          className="rounded-2xl border border-cyan-300/15 bg-cyan-300/4 p-4 text-left transition hover:border-cyan-300/35 hover:bg-cyan-300/[.07]"
        >
          <SourceCard source={source} />
        </button>
      );
    }
    return (
      <div key={source.id} className="rounded-2xl border border-white/7 bg-white/2 p-4 opacity-75">
        <SourceCard source={source} />
      </div>
    );
  };

  return (
    <div className="relative h-full overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(101,244,255,.08),transparent_34%),radial-gradient(circle_at_85%_28%,rgba(169,112,255,.09),transparent_30%)] px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-5xl">
        {/* Hero card */}
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-black/35 p-6 shadow-2xl backdrop-blur-xl sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-[.2em] text-cyan-200">
            <Sparkles size={12} /> LiTT Studio
          </div>
          <h1 className="mt-5 max-w-3xl text-3xl font-black tracking-tight sm:text-5xl" style={{ color: T.headerColor }}>
            Build something new or bring LiTT an existing project.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 sm:text-base" style={{ color: T.textMuted }}>
            Connect a repository, scan a website, upload your files, or describe your idea. LiTT will inspect the source, create a plan, and help you preview, approve, and ship it.
          </p>

          {/* Three primary actions */}
          <div className="mt-7 grid gap-3 md:grid-cols-3">
            <button
              onClick={() => { onToolChange("build"); void onStartBlank?.(); }}
              className="group rounded-2xl border border-lime-300/25 bg-lime-300/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-lime-300/50"
            >
              <Plus size={20} className="text-lime-300" />
              <div className="mt-4 text-sm font-black text-white">Start from an idea</div>
              <div className="mt-1 text-xs leading-5 text-white/45">Describe what you want and let LiTT build the first working draft.</div>
            </button>
            <button
              onClick={() => setSourcesOpen(true)}
              className="group rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/50"
            >
              <FolderGit2 size={20} className="text-cyan-300" />
              <div className="mt-4 text-sm font-black text-white">Connect a project</div>
              <div className="mt-1 text-xs leading-5 text-white/45">GitHub, Git URL, GitLab, Bitbucket, Azure DevOps, upload, or deployment.</div>
            </button>
            <Link
              href="/studio?tool=chat&mission=Scan%20this%20website%20and%20tell%20me%20what%20you%20find%3A%20"
              className="group rounded-2xl border border-violet-300/25 bg-violet-300/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-violet-300/50"
            >
              <Globe2 size={20} className="text-violet-300" />
              <div className="mt-4 text-sm font-black text-white">Scan a website</div>
              <div className="mt-1 text-xs leading-5 text-white/45">Review design, content, structure, integrations, performance, and next steps.</div>
            </Link>
          </div>

          {/* Secondary actions */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => { onToolChange("build"); void onStartBlank?.(); }}
              className="rounded-xl border border-white/10 bg-white/3 px-4 py-2 text-xs font-bold text-white/60 transition hover:border-white/20 hover:bg-white/6 hover:text-white"
            >
              Start Blank Project
            </button>
            <button
              onClick={() => setSourcesOpen(true)}
              className="rounded-xl border border-white/10 bg-white/3 px-4 py-2 text-xs font-bold text-white/60 transition hover:border-white/20 hover:bg-white/6 hover:text-white"
            >
              Connect a Source
            </button>
          </div>
        </div>

        {/* Popular starts + How it works */}
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <section className="rounded-3xl border border-white/8 bg-white/2.5 p-5">
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-white/35">Popular starts</div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {templates.map((template) => (
                <button
                  key={template}
                  onClick={() => {
                    window.history.replaceState(null, "", `/studio?tool=build&template=${encodeURIComponent(template)}`);
                    onToolChange("build");
                  }}
                  className="rounded-xl border border-white/8 bg-white/3 px-3 py-3 text-left text-xs font-bold text-white/70 transition hover:border-cyan-300/30 hover:bg-cyan-300/5 hover:text-white"
                >
                  {template}
                  <ArrowRight size={12} className="mt-3 text-white/25" />
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-3xl border border-white/8 bg-white/2.5 p-5">
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-white/35">How it works</div>
            <ol className="mt-4 space-y-4">
              {[
                ["1", "Connect", "Bring in an idea, project, or source."],
                ["2", "Direct LiTT", "Explain what you want changed or created."],
                ["3", "Review and ship", "Preview, approve changes, and deploy."],
              ].map(([number, title, detail]) => (
                <li key={number} className="flex gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/5 text-xs font-black text-cyan-200">{number}</span>
                  <span>
                    <b className="block text-xs text-white">{title}</b>
                    <span className="text-[11px] leading-5 text-white/40">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {/* Connect a Source modal */}
      {sourcesOpen && (
        <div
          className="fixed inset-0 z-10020 grid place-items-center bg-black/75 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-labelledby="connect-source-title"
        >
          <button className="absolute inset-0" onClick={() => setSourcesOpen(false)} aria-label="Close source chooser" />
          <div className="relative z-10 max-h-[88dvh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/10 bg-[#090b12] p-5 shadow-[0_30px_100px_rgba(0,0,0,.8)] sm:p-7">
            <button
              onClick={() => setSourcesOpen(false)}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/50 hover:bg-white/5 hover:text-white"
              aria-label="Close"
            >
              <X size={16} />
            </button>

            <div className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Connect a source</div>
            <h2 id="connect-source-title" className="mt-2 text-2xl font-black text-white">
              What should LiTT inspect?
            </h2>
            <p className="mt-2 text-sm text-white/45">
              Choose a source type. Available connections are marked. Others are visible so you can see the roadmap.
            </p>

            {/* Category tabs */}
            <div className="mt-5 flex flex-wrap gap-2">
              {SOURCE_CATEGORIES.map((cat, i) => {
                const CatIcon = cat.icon;
                return (
                  <button
                    key={cat.name}
                    onClick={() => { setActiveCategory(i); setShowMoreProviders(false); }}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      activeCategory === i
                        ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-200"
                        : "border-white/8 bg-white/2 text-white/50 hover:bg-white/5 hover:text-white/80"
                    }`}
                  >
                    <CatIcon size={14} />
                    {cat.name}
                  </button>
                );
              })}
            </div>

            {/* Source options grid */}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Code category: show quick providers, then "More" */}
              {activeCategory === 0 && !showMoreProviders ? (
                <>
                  {quickProviders.map(sourceCard)}
                  <button
                    onClick={() => setShowMoreProviders(true)}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/2 p-4 text-xs font-bold text-white/50 transition hover:border-white/25 hover:bg-white/4 hover:text-white/80"
                  >
                    More Git Providers <ArrowRight size={14} />
                  </button>
                </>
              ) : (
                SOURCE_CATEGORIES[activeCategory].options.map(sourceCard)
              )}
            </div>

            {inputSource && (
              <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/4 p-4">
                <label htmlFor="source-url" className="text-xs font-black text-white">
                  {inputSource === "git-url" ? "Repository URL" : "Website URL"}
                </label>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="source-url"
                    type="url"
                    value={sourceInput}
                    onChange={(event) => setSourceInput(event.target.value)}
                    placeholder={inputSource === "git-url" ? "https://github.com/owner/repository.git" : "https://example.com"}
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white outline-none placeholder:text-white/25 focus:border-cyan-300/40"
                    autoFocus
                  />
                  <button
                    onClick={continueWithSource}
                    disabled={!sourceInput.trim()}
                    className="rounded-xl bg-cyan-300 px-4 py-2.5 text-xs font-black text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Continue in Chat
                  </button>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-white/35">
                  This hands the URL and selected permission mode to LiTT. Private Git authentication and automatic cloning are not enabled yet.
                </p>
              </div>
            )}

            {/* Back to quick providers when in "More" */}
            {activeCategory === 0 && showMoreProviders && (
              <button
                onClick={() => setShowMoreProviders(false)}
                className="mt-4 text-xs font-bold text-cyan-300 hover:text-cyan-200"
              >
                ← Back to common providers
              </button>
            )}

            {/* Permission modes */}
            <div className="mt-6">
              <div className="text-[10px] font-black uppercase tracking-[.2em] text-white/35">Permission mode</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {PERMISSION_MODES.map((mode) => {
                  const ModeIcon = mode.icon;
                  const selected = permissionMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setPermissionMode(mode.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-emerald-300/40 bg-emerald-300/10"
                          : "border-white/8 bg-white/2 hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <ModeIcon size={14} className={selected ? "text-emerald-300" : "text-white/40"} />
                        <span className={`text-xs font-black ${selected ? "text-emerald-200" : "text-white/70"}`}>
                          {mode.label}
                        </span>
                        {mode.default && (
                          <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[8px] font-black uppercase text-white/30">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-[10px] leading-4 text-white/35">{mode.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Approval note */}
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/4 p-4">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <div className="text-xs font-black text-white">You stay in control</div>
                <p className="mt-1 text-[10px] leading-5 text-white/40">
                  LiTT inspects first. Writes, commands, branches, commits, and deployments remain separately controlled. Switch to Agent Mode only when you want LiTT to act autonomously.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SourceCard({ source }: { source: SourceOption }) {
  const Icon = source.icon;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <Icon size={18} className={source.available ? "text-cyan-300" : "text-white/25"} />
        {source.available ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-300/10 px-2 py-1 text-[8px] font-black uppercase text-emerald-200">
            <Check size={9} /> Available
          </span>
        ) : (
          <span className="rounded-full bg-white/5 px-2 py-1 text-[8px] font-black uppercase text-white/30">
            Coming soon
          </span>
        )}
      </div>
      <div className="mt-4 text-xs font-black text-white/85">{source.label}</div>
      <div className="mt-1 text-[10px] leading-4 text-white/35">{source.detail}</div>
    </>
  );
}
