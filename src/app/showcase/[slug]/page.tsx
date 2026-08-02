import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Check, Clock, GitFork, Music, BarChart3, Code2 } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL, buildMetadata } from "@/lib/seo";

interface ShowcaseProject {
  slug: string;
  title: string;
  mission: string;
  result: string;
  tools: string[];
  icon: typeof Music;
  accent: string;
  steps: { label: string; detail: string }[];
  duration: string;
  files: { name: string; size: string }[];
}

const PROJECTS: Record<string, ShowcaseProject> = {
  "artist-launch-site": {
    slug: "artist-launch-site",
    title: "Artist Launch Site",
    mission: "Build a premium website for a music artist with a hero, player, tour dates, and merch link.",
    result: "A responsive, deployed artist website with an embedded music player, tour dates, and social integration.",
    tools: ["HTML", "CSS", "JavaScript", "Image Generation", "Audio"],
    icon: Music,
    accent: "#b58cff",
    duration: "~4 min",
    steps: [
      { label: "Mission created", detail: "LiTT parsed the prompt and defined a premium music artist website with 5 sections." },
      { label: "Plan generated", detail: "6-step execution plan: hero, layout, player, tour dates, merch, deploy." },
      { label: "Files built", detail: "index.html, styles.css, player.js, and hero image generated in the workspace." },
      { label: "Preview rendered", detail: "Live preview showed the responsive layout with the music player functioning." },
      { label: "Approved for deploy", detail: "User reviewed the preview and approved deployment to a public URL." },
      { label: "Deployed live", detail: "Production bundle built and deployed to the edge network. Site is live." },
    ],
    files: [
      { name: "index.html", size: "4.2 KB" },
      { name: "styles.css", size: "8.1 KB" },
      { name: "player.js", size: "3.7 KB" },
      { name: "assets/hero.jpg", size: "124 KB" },
    ],
  },
  "small-business-dashboard": {
    slug: "small-business-dashboard",
    title: "Small Business Dashboard",
    mission: "Create a data dashboard for a small business showing sales, inventory, and customer metrics.",
    result: "An interactive dashboard with charts, filters, and exportable reports.",
    tools: ["React", "Charts", "Data", "Responsive"],
    icon: BarChart3,
    accent: "#65f4ff",
    duration: "~6 min",
    steps: [
      { label: "Mission created", detail: "LiTT defined a business dashboard with sales, inventory, and customer panels." },
      { label: "Plan generated", detail: "8-step plan: data model, chart components, filters, layout, export, deploy." },
      { label: "Data structure built", detail: "Mock data layer created with sales, inventory, and customer records." },
      { label: "Chart components built", detail: "Bar, line, and pie chart components generated with responsive sizing." },
      { label: "Filter system added", detail: "Date range and category filters connected to the data layer." },
      { label: "Layout assembled", detail: "Grid layout with sidebar navigation and main content area." },
      { label: "Export feature built", detail: "CSV export functionality added to all report views." },
      { label: "Deployed live", detail: "Dashboard deployed and accessible via public URL." },
    ],
    files: [
      { name: "index.html", size: "6.8 KB" },
      { name: "app.js", size: "12.3 KB" },
      { name: "charts.js", size: "9.4 KB" },
      { name: "styles.css", size: "11.2 KB" },
      { name: "data/sales.json", size: "2.1 KB" },
    ],
  },
  "music-campaign": {
    slug: "music-campaign",
    title: "Music Campaign",
    mission: "Generate cover artwork, promotional copy, and social assets for a single release campaign.",
    result: "Cover art, three social posts, and a press kit — all brand-consistent and ready to publish.",
    tools: ["Image Generation", "Copywriting", "Social", "Branding"],
    icon: Code2,
    accent: "#a8ff2f",
    duration: "~3 min",
    steps: [
      { label: "Mission created", detail: "LiTT defined a single release campaign with cover art, social posts, and press kit." },
      { label: "Plan generated", detail: "5-step plan: brand direction, cover art, social copy, social assets, press kit." },
      { label: "Cover art generated", detail: "AI-generated cover artwork in 3 variations, user selected the final design." },
      { label: "Social copy written", detail: "Promotional copy for 3 social posts with hashtags and call-to-action." },
      { label: "Press kit assembled", detail: "One-page press kit with artist bio, release info, and downloadable assets." },
    ],
    files: [
      { name: "cover-art-final.png", size: "2.4 MB" },
      { name: "social-post-1.png", size: "890 KB" },
      { name: "social-post-2.png", size: "1.1 MB" },
      { name: "social-post-3.png", size: "920 KB" },
      { name: "press-kit.pdf", size: "340 KB" },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(PROJECTS).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return params.then((p) => {
    const project = PROJECTS[p.slug];
    if (!project) return buildMetadata({ title: "Project not found", path: "/showcase", index: false });
    return buildMetadata({
      title: `${project.title} — LiTTree Showcase`,
      description: project.mission,
      path: `/showcase/${project.slug}`,
      index: true,
    });
  });
}

export default async function ShowcasePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = PROJECTS[slug];
  if (!project) notFound();

  const Icon = project.icon;

  const schema = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: project.title,
    description: project.mission,
    creator: { "@type": "Organization", name: SITE_NAME },
    url: `${SITE_URL}/showcase/${project.slug}`,
  };

  return (
    <main className="min-h-screen bg-[#03050a] text-white">
      <JsonLd data={schema} />

      <header className="border-b border-white/8 bg-[#03050a]/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5">
          <Link href="/#creations" className="flex items-center gap-2 text-sm font-bold text-white/60 transition hover:text-white"><ArrowRight size={14} className="rotate-180" /> Back to showcase</Link>
          <Link href="/sign-up?redirect=/studio" className="inline-flex items-center gap-2 rounded-full bg-[#a8ff2f] px-4 py-2 text-xs font-black text-[#03050a] transition hover:bg-[#b8ff5f]"><GitFork size={12} /> Remix this project</Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-12 lg:py-16">
        <div className="flex items-start gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border" style={{ borderColor: `${project.accent}30`, backgroundColor: `${project.accent}10`, color: project.accent }}><Icon size={28} /></div>
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em]" style={{ color: project.accent }}>LiTTree Showcase</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{project.title}</h1>
            <div className="mt-2 flex items-center gap-4 text-xs font-bold text-white/40"><span className="flex items-center gap-1.5"><Clock size={11} /> {project.duration}</span><span className="flex items-center gap-1.5"><Check size={11} /> {project.steps.length} steps</span></div>
          </div>
        </div>

        <section className="mt-10 rounded-2xl border border-white/10 bg-[#0a0d14] p-6">
          <div className="text-xs font-black uppercase tracking-wider text-white/40">Original Mission</div>
          <p className="mt-2 text-lg leading-7 text-white/80">{project.mission}</p>
        </section>

        <section className="mt-6 rounded-2xl border p-6" style={{ borderColor: `${project.accent}20`, backgroundColor: `${project.accent}05` }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: project.accent }}>Final Result</div>
          <p className="mt-2 text-lg leading-7 text-white/80">{project.result}</p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-black">Build steps</h2>
          <div className="mt-4 space-y-2">
            {project.steps.map((step, i) => (
              <div key={step.label} className="flex items-start gap-4 rounded-xl border border-white/8 bg-[#0a0d14] p-4">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black" style={{ backgroundColor: `${project.accent}12`, color: project.accent }}>{i + 1}</span>
                <div><div className="text-sm font-black text-white">{step.label}</div><div className="mt-1 text-xs leading-5 text-white/50">{step.detail}</div></div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-black">Tools used</h2>
          <div className="mt-4 flex flex-wrap gap-2">{project.tools.map((tool) => (<span key={tool} className="rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-xs font-bold text-white/60">{tool}</span>))}</div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-black">Files generated</h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-white/8">
            {project.files.map((file, i) => (<div key={file.name} className={`flex items-center justify-between px-4 py-3 text-sm ${i % 2 === 0 ? "bg-[#0a0d14]" : "bg-white/3"}`}><span className="font-mono text-white/70">{file.name}</span><span className="text-xs font-bold text-white/30">{file.size}</span></div>))}
          </div>
        </section>

        <div className="mt-12 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0a0d14] p-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <div><div className="text-lg font-black">Want to build something like this?</div><div className="mt-1 text-sm text-white/50">Start your own project in LiTTree Studio.</div></div>
          <Link href="/sign-up" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#a8ff2f] px-6 py-3 text-sm font-black text-[#03050a] transition hover:bg-[#b8ff5f]">Start building free <ArrowRight size={14} /></Link>
        </div>
      </div>
    </main>
  );
}
