import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CircleDot, Sparkles } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL, buildMetadata } from "@/lib/seo";
import { PROJECTS } from "../projects";

export function generateStaticParams() {
  return Object.keys(PROJECTS).map((slug) => ({ slug }));
}

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return params.then((p) => {
    const project = PROJECTS[p.slug];
    if (!project) return buildMetadata({ title: "Demo not found", path: "/showcase", index: false });
    return buildMetadata({
      title: `${project.title} — LiTTree Product Demo`,
      description: project.prompt,
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
    description: project.prompt,
    creator: { "@type": "Organization", name: SITE_NAME },
    url: `${SITE_URL}/showcase/${project.slug}`,
  };

  return (
    <main className="min-h-screen bg-[#03050a] text-white">
      <JsonLd data={schema} />

      <header className="border-b border-white/8 bg-[#03050a]/80 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5">
          <Link href="/#creations" className="flex items-center gap-2 text-sm font-bold text-white/60 transition hover:text-white">
            <ArrowRight size={14} className="rotate-180" /> Back to demos
          </Link>
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-[#a8ff2f] px-4 py-2 text-xs font-black text-[#03050a] transition hover:bg-[#b8ff5f]">
            <Sparkles size={12} /> Try it yourself
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-12 lg:py-16">
        {/* Demo disclaimer banner */}
        <div className="mb-8 rounded-xl border border-white/10 bg-white/3 px-4 py-3 text-center text-xs text-white/50">
          <strong className="text-white/70">Product demonstration.</strong> This is an illustrative simulation of the LiTTree workflow, not a live deployed project.
        </div>

        {/* Project header */}
        <div className="flex items-start gap-4">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border"
            style={{ borderColor: `${project.accent}30`, backgroundColor: `${project.accent}10`, color: project.accent }}
          >
            <Icon size={28} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em]" style={{ color: project.accent }}>
              Product Demo
            </div>
            <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">{project.title}</h1>
            <div className="mt-2 flex items-center gap-4 text-xs font-bold text-white/40">
              <span className="flex items-center gap-1.5"><CircleDot size={11} /> {project.steps.length} steps</span>
            </div>
          </div>
        </div>

        {/* Prompt */}
        <section className="mt-10 rounded-2xl border border-white/10 bg-[#0a0d14] p-6">
          <div className="text-xs font-black uppercase tracking-wider text-white/40">User Prompt</div>
          <p className="mt-2 text-lg leading-7 text-white/80">{project.prompt}</p>
        </section>

        {/* Outcome */}
        <section className="mt-6 rounded-2xl border p-6" style={{ borderColor: `${project.accent}20`, backgroundColor: `${project.accent}05` }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: project.accent }}>Expected Outcome</div>
          <p className="mt-2 text-lg leading-7 text-white/80">{project.outcome}</p>
        </section>

        {/* Workflow steps */}
        <section className="mt-10">
          <h2 className="text-xl font-black">Workflow simulation</h2>
          <p className="mt-1 text-xs text-white/40">These steps illustrate what LiTTree does during a typical project.</p>
          <div className="mt-4 space-y-2">
            {project.steps.map((step, i) => (
              <div key={step.label} className="flex items-start gap-4 rounded-xl border border-white/8 bg-[#0a0d14] p-4">
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black"
                  style={{ backgroundColor: `${project.accent}12`, color: project.accent }}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-black text-white">{step.label}</div>
                  <div className="mt-1 text-xs leading-5 text-white/50">{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tools */}
        <section className="mt-10">
          <h2 className="text-xl font-black">Tools used</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {project.tools.map((tool) => (
              <span key={tool} className="rounded-lg border border-white/10 bg-white/3 px-3 py-2 text-xs font-bold text-white/60">
                {tool}
              </span>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="mt-12 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#0a0d14] p-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <div>
            <div className="text-lg font-black">Want to build something like this?</div>
            <div className="mt-1 text-sm text-white/50">Start your own project in LiTTree Studio.</div>
          </div>
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#a8ff2f] px-6 py-3 text-sm font-black text-[#03050a] transition hover:bg-[#b8ff5f]"
          >
            Start building free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </main>
  );
}
