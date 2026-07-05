import Link from "next/link";
import { ArrowRight, Bot, GalleryVerticalEnd, Workflow, WandSparkles } from "lucide-react";

const DOC_SECTIONS = [
  {
    icon: WandSparkles,
    title: "Start in Studio",
    body: "Use Studio as the main workspace for image, audio, video, agent chat, flow, gallery, and external space tools.",
    href: "/studio",
  },
  {
    icon: Bot,
    title: "Install Agents",
    body: "Browse specialist agents for code, content, research, analytics, music, design, and orchestration.",
    href: "/agents",
  },
  {
    icon: Workflow,
    title: "Build Flows",
    body: "Chain prompts and media tasks into repeatable workflows for creative production and publishing.",
    href: "/flow",
  },
  {
    icon: GalleryVerticalEnd,
    title: "Save Output",
    body: "Keep generated work in the gallery, reuse it in your profile, and prepare it for community sharing.",
    href: "/gallery",
  },
];

export const metadata = {
  title: "Docs",
  description: "Quick-start documentation for LiTTree Lab Studios.",
};

export default function DocsPage() {
  return (
    <main className="min-h-screen px-4 py-16" style={{ backgroundColor: "#08080c", color: "#e2e2e9" }}>
      <div className="mx-auto max-w-5xl">
        <div className="mb-10">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-cyan-300">Documentation</p>
          <h1 className="mb-4 text-4xl font-black tracking-tight text-slate-50 md:text-6xl">
            Build, automate, publish.
          </h1>
          <p className="max-w-2xl text-base leading-relaxed opacity-65 md:text-lg">
            LiTTree Lab Studios is organized around one loop: choose an agent, create in Studio,
            automate the repeatable parts, and ship the result to your audience or marketplace.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {DOC_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.title}
                href={section.href}
                className="group rounded-2xl border p-6 transition-all hover:-translate-y-1 hover:bg-white/[0.03]"
                style={{ backgroundColor: "#12121a", borderColor: "#26262e" }}
              >
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-300">
                  <Icon size={20} />
                </div>
                <h2 className="mb-2 text-lg font-black text-slate-50">{section.title}</h2>
                <p className="mb-5 text-sm leading-relaxed opacity-60">{section.body}</p>
                <span className="inline-flex items-center gap-2 text-sm font-bold text-cyan-300">
                  Open <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
