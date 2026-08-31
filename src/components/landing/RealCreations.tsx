import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BarChart3, Music2, Palette } from "lucide-react";

const PROJECTS = [
  {
    slug: "artist-launch-site",
    title: "Artist launch experience",
    prompt: "Build a premium release site with a hero, player, tour dates, and a merch path.",
    outcome: "Responsive launch site + organized project files",
    tools: ["Web", "Image", "Audio", "Copy"],
    icon: Music2,
    accent: "#b58cff",
    image: "/gallery/museum/neon-cyber-city.png",
    imageAlt: "Neon city artwork representing an independent artist launch experience",
  },
  {
    slug: "small-business-dashboard",
    title: "Business control center",
    prompt: "Create a clear dashboard for sales, inventory, customers, and operational follow-up.",
    outcome: "Interactive dashboard + reusable data views",
    tools: ["React", "Charts", "Data", "Export"],
    icon: BarChart3,
    accent: "#65f4ff",
    image: "/showcase/control-center.png",
    imageAlt: "Futuristic business dashboard with operational metrics and agent status",
  },
  {
    slug: "music-campaign",
    title: "Complete release campaign",
    prompt: "Create the visual direction, cover concept, campaign copy, and coordinated social assets.",
    outcome: "Brand-consistent campaign kit",
    tools: ["Brand", "Image", "Copy", "Social"],
    icon: Palette,
    accent: "#a8ff2f",
    image: "/studio/creative-engine-hero.png",
    imageAlt: "Creative engine artwork representing a coordinated multimedia campaign",
  },
] as const;

export function RealCreations() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {PROJECTS.map((project, index) => {
        const Icon = project.icon;
        return (
          <article key={project.slug} data-reveal className="litt-project-card group" style={{ "--reveal-index": index } as React.CSSProperties}>
            <div className="relative aspect-[1.45/1] overflow-hidden border-b border-white/9">
              <Image
                src={project.image}
                alt={project.imageAlt}
                fill
                sizes="(max-width: 1024px) 92vw, 33vw"
                className="litt-project-image object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(5,7,13,.94),rgba(5,7,13,.06)_70%),linear-gradient(90deg,rgba(5,7,13,.5),transparent)]" />
              <div className="absolute inset-x-4 top-4 flex items-center justify-between">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-[#05070d]/72 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/70 backdrop-blur-xl">
                  <Icon size={11} style={{ color: project.accent }} /> Product demo
                </span>
                <span className="font-mono text-[10px] font-black text-white/42">0{index + 1}</span>
              </div>
              <div className="absolute inset-x-5 bottom-5">
                <h3 className="text-2xl font-black tracking-[-0.035em] text-white">{project.title}</h3>
              </div>
            </div>

            <div className="flex flex-1 flex-col p-5 sm:p-6">
              <p className="text-sm leading-6 text-white/52">“{project.prompt}”</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {project.tools.map((tool) => <span key={tool} className="rounded-full border border-white/8 bg-white/3 px-2.5 py-1 text-[10px] font-bold text-white/46">{tool}</span>)}
              </div>
              <div className="mt-6 border-t border-white/8 pt-4">
                <div className="text-[9px] font-black uppercase tracking-[0.16em] text-white/28">Outcome</div>
                <p className="mt-1.5 text-xs font-bold text-white/64">{project.outcome}</p>
              </div>
              <Link href={`/showcase/${project.slug}`} className="mt-6 inline-flex items-center justify-between rounded-xl border border-white/10 bg-white/4 px-4 py-3 text-xs font-black text-white/72 transition hover:border-white/20 hover:bg-white/7 hover:text-white">
                View the workflow <ArrowRight size={14} style={{ color: project.accent }} />
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
