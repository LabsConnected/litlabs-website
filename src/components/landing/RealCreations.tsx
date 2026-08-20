import Link from "next/link";
import { Music, Code2, BarChart3 } from "lucide-react";

/**
 * RealCreations — three product demonstration cards.
 *
 * These are NOT real deployed projects. They are illustrative simulations
 * showing the LiTTree workflow. No fake durations, file sizes, or deployment
 * claims are made. Each card links to a demo page with the workflow steps.
 */

interface DemoProject {
  slug: string;
  title: string;
  prompt: string;
  outcome: string;
  tools: string[];
  icon: typeof Music;
  accent: string;
}

const PROJECTS: DemoProject[] = [
  {
    slug: "artist-launch-site",
    title: "Artist Launch Site",
    prompt: "Build a premium website for a music artist with a hero, player, tour dates, and merch link.",
    outcome: "A responsive artist website with an embedded music player and social integration.",
    tools: ["HTML", "CSS", "JavaScript", "Image Gen", "Audio"],
    icon: Music,
    accent: "#b58cff",
  },
  {
    slug: "small-business-dashboard",
    title: "Small Business Dashboard",
    prompt: "Create a data dashboard for a small business showing sales, inventory, and customer metrics.",
    outcome: "An interactive dashboard with charts, filters, and exportable reports.",
    tools: ["React", "Charts", "Data", "Responsive"],
    icon: BarChart3,
    accent: "#65f4ff",
  },
  {
    slug: "music-campaign",
    title: "Music Campaign",
    prompt: "Generate cover artwork, promotional copy, and social assets for a single release campaign.",
    outcome: "Cover art, three social posts, and a press kit — all brand-consistent.",
    tools: ["Image Gen", "Copy", "Social", "Branding"],
    icon: Code2,
    accent: "#a8ff2f",
  },
];

export function RealCreations() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {PROJECTS.map((project) => {
        const Icon = project.icon;
        return (
          <article
            key={project.slug}
            className="group flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0a0d14] transition duration-300 hover:-translate-y-1 hover:border-white/25"
          >
            {/* Visual header */}
            <div
              className="relative flex h-32 items-center justify-center overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${project.accent}15, transparent 60%)`,
              }}
            >
              <div
                className="grid h-14 w-14 place-items-center rounded-2xl border transition duration-300 group-hover:scale-110"
                style={{
                  borderColor: `${project.accent}30`,
                  backgroundColor: `${project.accent}10`,
                  color: project.accent,
                }}
              >
                <Icon size={24} />
              </div>
            </div>

            {/* Content */}
            <div className="flex flex-1 flex-col p-5">
              <h3 className="text-lg font-black text-white">{project.title}</h3>
              <p className="mt-2 text-xs leading-5 text-white/50">{project.prompt}</p>

              {/* Tools */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {project.tools.map((tool) => (
                  <span
                    key={tool}
                    className="rounded-md border border-white/8 bg-white/3 px-2 py-1 text-[10px] font-bold text-white/50"
                  >
                    {tool}
                  </span>
                ))}
              </div>

              {/* Demo label */}
              <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-white/30">
                Product demonstration
              </div>

              {/* Actions */}
              <div className="mt-auto pt-5">
                <Link
                  href={`/showcase/${project.slug}`}
                  className="block w-full rounded-lg border border-white/12 py-2.5 text-center text-xs font-bold text-white/70 transition hover:bg-white/5"
                >
                  View workflow
                </Link>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
