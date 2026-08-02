import Link from "next/link";
import { ArrowRight, Clock, GitFork, Music, Code2, BarChart3 } from "lucide-react";

interface ShowcaseProject {
  slug: string;
  title: string;
  mission: string;
  result: string;
  tools: string[];
  icon: typeof Music;
  accent: string;
  steps: number;
  duration: string;
}

const PROJECTS: ShowcaseProject[] = [
  { slug: "artist-launch-site", title: "Artist Launch Site", mission: "Build a premium website for a music artist with a hero, player, tour dates, and merch link.", result: "A responsive, deployed artist website with an embedded music player and social integration.", tools: ["HTML", "CSS", "JavaScript", "Image Gen", "Audio"], icon: Music, accent: "#b58cff", steps: 6, duration: "~4 min" },
  { slug: "small-business-dashboard", title: "Small Business Dashboard", mission: "Create a data dashboard for a small business showing sales, inventory, and customer metrics.", result: "An interactive dashboard with charts, filters, and exportable reports.", tools: ["React", "Charts", "Data", "Responsive"], icon: BarChart3, accent: "#65f4ff", steps: 8, duration: "~6 min" },
  { slug: "music-campaign", title: "Music Campaign", mission: "Generate cover artwork, promotional copy, and social assets for a single release campaign.", result: "Cover art, three social posts, and a press kit — all brand-consistent and ready to publish.", tools: ["Image Gen", "Copy", "Social", "Branding"], icon: Code2, accent: "#a8ff2f", steps: 5, duration: "~3 min" },
];

export function RealCreations() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {PROJECTS.map((project) => {
        const Icon = project.icon;
        return (
          <article key={project.slug} className="group flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0a0d14] transition duration-300 hover:-translate-y-1 hover:border-white/25">
            <div className="relative flex h-32 items-center justify-center overflow-hidden" style={{ background: `linear-gradient(135deg, ${project.accent}15, transparent 60%)` }}>
              <div className="grid h-14 w-14 place-items-center rounded-2xl border transition duration-300 group-hover:scale-110" style={{ borderColor: `${project.accent}30`, backgroundColor: `${project.accent}10`, color: project.accent }}><Icon size={24} /></div>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h3 className="text-lg font-black text-white">{project.title}</h3>
              <p className="mt-2 text-xs leading-5 text-white/50">{project.mission}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{project.tools.map((tool) => (<span key={tool} className="rounded-md border border-white/8 bg-white/3 px-2 py-1 text-[10px] font-bold text-white/50">{tool}</span>))}</div>
              <div className="mt-4 flex items-center gap-4 text-[10px] font-bold text-white/30"><span className="flex items-center gap-1.5"><Clock size={11} /> {project.duration}</span><span className="flex items-center gap-1.5"><ArrowRight size={11} /> {project.steps} steps</span></div>
              <div className="mt-auto flex gap-2 pt-5">
                <Link href={`/showcase/${project.slug}`} className="flex-1 rounded-lg border border-white/12 py-2.5 text-center text-xs font-bold text-white/70 transition hover:bg-white/5">View project</Link>
                <Link href={`/sign-up?redirect=/studio&template=${project.slug}`} className="flex-1 rounded-lg border py-2.5 text-center text-xs font-bold transition" style={{ borderColor: `${project.accent}25`, backgroundColor: `${project.accent}08`, color: project.accent }}><span className="inline-flex items-center gap-1.5"><GitFork size={11} /> Remix</span></Link>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
