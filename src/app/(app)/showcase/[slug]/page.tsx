import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CircleDot, Sparkles } from "lucide-react";
import { JsonLd } from "@/components/seo/JsonLd";
import { SITE_NAME, SITE_URL, buildMetadata } from "@/lib/seo";
import { PROJECTS } from "../projects";
import "@/app/public-pages-tlc.css";

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
    <main className="litt-public-light min-h-screen bg-white text-[#0e1510] selection:bg-[#8fd14f]/60">
      <JsonLd data={schema} />

      <header className="border-b border-[#cfdec4] bg-white/85 backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-5">
          <Link href="/#creations" className="flex items-center gap-2 text-sm font-bold text-[#0e1510]/60 transition hover:text-[#0c5a26]">
            <ArrowRight size={14} className="rotate-180" /> Back to demos
          </Link>
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-black text-on-accent transition hover:bg-accent-strong">
            <Sparkles size={12} /> Try it yourself
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5 py-12 lg:py-16">
        {/* Demo disclaimer banner */}
        <div className="mb-8 rounded-xl border border-[#cfdec4] bg-[#f2f7ea] px-4 py-3 text-center text-xs text-[#0e1510]/60">
          <strong className="text-[#0e1510]/80">Product demonstration.</strong> This is an illustrative simulation of the LiTTree workflow, not a live deployed project.
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
            <div className="mt-2 flex items-center gap-4 text-xs font-bold text-[#0e1510]/45">
              <span className="flex items-center gap-1.5"><CircleDot size={11} /> {project.steps.length} steps</span>
            </div>
          </div>
        </div>

        {/* Prompt */}
        <section className="mt-10 rounded-2xl border border-[#cfdec4] bg-[#f2f7ea] p-6">
          <div className="text-xs font-black uppercase tracking-wider text-[#0e1510]/45">User Prompt</div>
          <p className="mt-2 text-lg leading-7 text-[#0e1510]/85">{project.prompt}</p>
        </section>

        {/* Outcome */}
        <section className="mt-6 rounded-2xl border p-6" style={{ borderColor: `${project.accent}20`, backgroundColor: `${project.accent}05` }}>
          <div className="text-xs font-black uppercase tracking-wider" style={{ color: project.accent }}>Expected Outcome</div>
          <p className="mt-2 text-lg leading-7 text-[#0e1510]/85">{project.outcome}</p>
        </section>

        {/* Workflow steps */}
        <section className="mt-10">
          <h2 className="text-xl font-black">Workflow simulation</h2>
          <p className="mt-1 text-xs text-[#0e1510]/45">These steps illustrate what LiTTree does during a typical project.</p>
          <div className="mt-4 space-y-2">
            {project.steps.map((step, i) => (
              <div key={step.label} className="flex items-start gap-4 rounded-xl border border-[#cfdec4] bg-[#f2f7ea] p-4">
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black"
                  style={{ backgroundColor: `${project.accent}12`, color: project.accent }}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-black text-[#0e1510]">{step.label}</div>
                  <div className="mt-1 text-xs leading-5 text-[#0e1510]/55">{step.detail}</div>
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
              <span key={tool} className="rounded-lg border border-[#cfdec4] bg-[#f2f7ea] px-3 py-2 text-xs font-bold text-[#0e1510]/65">
                {tool}
              </span>
            ))}
          </div>
        </section>

        {/* CTA */}
        <div className="mt-12 flex flex-col gap-3 rounded-2xl border border-[#cfdec4] bg-[#f2f7ea] p-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <div>
            <div className="text-lg font-black">Want to build something like this?</div>
            <div className="mt-1 text-sm text-[#0e1510]/55">Start your own project in LiTTree Studio.</div>
          </div>
          <Link
            href="/sign-up"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3 text-sm font-black text-on-accent transition hover:bg-accent-strong"
          >
            Start building free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </main>
  );
}
