"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Code2,
  Database,
  FolderGit2,
  Globe2,
  HardDriveUpload,
  Link2,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import type { StudioTool } from "./StudioSidebar";

type SourceOption = {
  label: string;
  detail: string;
  icon: typeof FolderGit2;
  available: boolean;
  href?: string;
};

const SOURCE_OPTIONS: SourceOption[] = [
  { label: "GitHub Repository", detail: "GitHub App · repositories and branches", icon: FolderGit2, available: true, href: "/studio/github" },
  { label: "Paste Git URL", detail: "Clone any public or private Git repository", icon: Link2, available: false },
  { label: "Website URL", detail: "Inspect pages, copy, structure, and assets", icon: Globe2, available: true, href: "/studio?tool=chat&mission=Scan%20this%20website%20and%20create%20a%20project%20plan%3A%20" },
  { label: "Upload ZIP or Folder", detail: "Bring an existing local project", icon: HardDriveUpload, available: false },
  { label: "GitLab", detail: "OAuth repository connection", icon: FolderGit2, available: false },
  { label: "Bitbucket", detail: "Atlassian repository connection", icon: FolderGit2, available: false },
  { label: "Azure DevOps", detail: "Microsoft repository connection", icon: Code2, available: false },
  { label: "Figma Design", detail: "Screens, components, styles, and tokens", icon: Code2, available: false },
  { label: "API or Database", detail: "OpenAPI, Supabase, schema, or endpoint", icon: Database, available: false },
  { label: "Existing Deployment", detail: "Vercel or live-site configuration", icon: Rocket, available: false },
];

export default function StudioOnboarding({
  onToolChange,
  onStartBlank,
}: {
  onToolChange: (tool: StudioTool) => void;
  onStartBlank?: () => Promise<void> | void;
}) {
  const { resolvedColors: T } = useTheme();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const templates = ["Landing Page", "Dashboard", "SaaS App", "Portfolio", "Store", "Custom"];

  return (
    <div className="relative h-full overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,rgba(101,244,255,.08),transparent_34%),radial-gradient(circle_at_85%_28%,rgba(169,112,255,.09),transparent_30%)] px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-5xl">
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

          <div className="mt-7 grid gap-3 md:grid-cols-3">
            <button onClick={() => { onToolChange("build"); void onStartBlank?.(); }} className="group rounded-2xl border border-lime-300/25 bg-lime-300/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-lime-300/50">
              <Plus size={20} className="text-lime-300" />
              <div className="mt-4 text-sm font-black text-white">Start from an idea</div>
              <div className="mt-1 text-xs leading-5 text-white/45">Describe what you want and let LiTT build the first working draft.</div>
            </button>
            <button onClick={() => setSourcesOpen(true)} className="group rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-300/50">
              <FolderGit2 size={20} className="text-cyan-300" />
              <div className="mt-4 text-sm font-black text-white">Connect a project</div>
              <div className="mt-1 text-xs leading-5 text-white/45">Choose a repository, website, upload, design, deployment, or data source.</div>
            </button>
            <Link href="/studio?tool=chat&mission=Scan%20this%20website%20and%20tell%20me%20what%20you%20find%3A%20" className="group rounded-2xl border border-violet-300/25 bg-violet-300/10 p-5 text-left transition hover:-translate-y-0.5 hover:border-violet-300/50">
              <Globe2 size={20} className="text-violet-300" />
              <div className="mt-4 text-sm font-black text-white">Scan a website</div>
              <div className="mt-1 text-xs leading-5 text-white/45">Review design, content, structure, integrations, performance, and next steps.</div>
            </Link>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => { onToolChange("build"); void onStartBlank?.(); }} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-2 text-xs font-bold text-white/60 transition hover:border-white/20 hover:bg-white/[.06] hover:text-white">
              Start Blank Project
            </button>
            <button onClick={() => setSourcesOpen(true)} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-2 text-xs font-bold text-white/60 transition hover:border-white/20 hover:bg-white/[.06] hover:text-white">
              Connect a Source
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
          <section className="rounded-3xl border border-white/8 bg-white/[.025] p-5">
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-white/35">Popular starts</div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {templates.map((template) => (
                <button key={template} onClick={() => { window.history.replaceState(null, "", `/studio?tool=build&template=${encodeURIComponent(template)}`); onToolChange("build"); }} className="rounded-xl border border-white/8 bg-white/[.03] px-3 py-3 text-left text-xs font-bold text-white/70 transition hover:border-cyan-300/30 hover:bg-cyan-300/5 hover:text-white">
                  {template}<ArrowRight size={12} className="mt-3 text-white/25" />
                </button>
              ))}
            </div>
          </section>
          <section className="rounded-3xl border border-white/8 bg-white/[.025] p-5">
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-white/35">How it works</div>
            <ol className="mt-4 space-y-4">
              {[
                ["1", "Connect", "Bring in an idea, project, or source."],
                ["2", "Direct LiTT", "Explain what you want changed or created."],
                ["3", "Review and ship", "Preview, approve changes, and deploy."],
              ].map(([number, title, detail]) => (
                <li key={number} className="flex gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/5 text-xs font-black text-cyan-200">{number}</span>
                  <span><b className="block text-xs text-white">{title}</b><span className="text-[11px] leading-5 text-white/40">{detail}</span></span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>

      {sourcesOpen && (
        <div className="fixed inset-0 z-10020 grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="connect-source-title">
          <button className="absolute inset-0" onClick={() => setSourcesOpen(false)} aria-label="Close source chooser" />
          <div className="relative z-10 max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-[#090b12] p-5 shadow-[0_30px_100px_rgba(0,0,0,.8)] sm:p-7">
            <button onClick={() => setSourcesOpen(false)} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-xl border border-white/10 text-white/50 hover:bg-white/5 hover:text-white" aria-label="Close"><X size={16} /></button>
            <div className="text-[10px] font-black uppercase tracking-[.2em] text-cyan-300">Connect a source</div>
            <h2 id="connect-source-title" className="mt-2 text-2xl font-black text-white">What should LiTT inspect?</h2>
            <p className="mt-2 text-sm text-white/45">Only working connections are marked available. The rest stay visible so users understand the roadmap without being misled.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SOURCE_OPTIONS.map((source) => {
                const Icon = source.icon;
                const content = <><div className="flex items-start justify-between gap-2"><Icon size={18} className={source.available ? "text-cyan-300" : "text-white/25"} />{source.available ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-300/10 px-2 py-1 text-[8px] font-black uppercase text-emerald-200"><Check size={9} /> Available</span> : <span className="rounded-full bg-white/5 px-2 py-1 text-[8px] font-black uppercase text-white/30">Coming soon</span>}</div><div className="mt-4 text-xs font-black text-white/85">{source.label}</div><div className="mt-1 text-[10px] leading-4 text-white/35">{source.detail}</div></>;
                return source.available && source.href ? <Link key={source.label} href={source.href} className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.04] p-4 transition hover:border-cyan-300/35 hover:bg-cyan-300/[.07]">{content}</Link> : <div key={source.label} className="rounded-2xl border border-white/7 bg-white/[.02] p-4 opacity-75">{content}</div>;
              })}
            </div>
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-300/15 bg-emerald-300/[.04] p-4">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-emerald-300" />
              <div><div className="text-xs font-black text-white">Approval Required by default</div><p className="mt-1 text-[10px] leading-5 text-white/40">LiTT can inspect first. Writes, commands, branches, commits, and deployments remain separately controlled.</p></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
