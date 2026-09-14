import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";
import { PROJECT_LIST } from "./projects";

/**
 * PublicShowcaseGallery — the /showcase index for signed-out visitors.
 *
 * Previously this route bounced strangers to the sign-in page even though
 * the /showcase/[slug] demo pages are public. Now visitors get a real
 * gallery of the public product demos instead of a login wall.
 * Signed-in users keep the full app-shell showcase experience.
 */
export default function PublicShowcaseGallery() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6">
      <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-[#a8ff2f]">
        Showcase
      </p>
      <h1 className="mb-4 text-4xl font-black tracking-tight text-white md:text-6xl">
        See what LiTT can build.
      </h1>
      <p className="mb-3 max-w-2xl text-base leading-relaxed text-white/55 md:text-lg">
        Walk through full product demonstrations — from the first prompt to
        the finished result. Each demo shows the mission, the plan, and every
        build step along the way.
      </p>
      <p className="mb-10 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/50">
        <FlaskConical size={13} className="text-[#65f4ff]" />
        Illustrative simulations — not live customer work
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {PROJECT_LIST.map((project) => {
          const Icon = project.icon;
          return (
            <Link
              key={project.slug}
              href={`/showcase/${project.slug}`}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:-translate-y-1 hover:border-white/20"
            >
              <div
                className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${project.accent}20`, color: project.accent }}
              >
                <Icon size={20} />
              </div>
              <h2 className="mb-2 text-lg font-black text-white">
                {project.title}
              </h2>
              <p className="mb-4 text-sm leading-relaxed text-white/50">
                {project.outcome}
              </p>
              <div className="mb-5 flex flex-wrap gap-1.5">
                {project.tools.slice(0, 3).map((tool) => (
                  <span
                    key={tool}
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/45"
                  >
                    {tool}
                  </span>
                ))}
              </div>
              <span
                className="inline-flex items-center gap-2 text-sm font-bold"
                style={{ color: project.accent }}
              >
                View the demo
                <ArrowRight
                  size={14}
                  className="transition-transform group-hover:translate-x-1"
                />
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-12 rounded-2xl border border-white/10 bg-gradient-to-br from-[#a8ff2f]/10 to-[#65f4ff]/10 p-8 text-center">
        <h2 className="mb-2 text-2xl font-black text-white">
          Ready to run your own mission?
        </h2>
        <p className="mx-auto mb-6 max-w-xl text-sm leading-relaxed text-white/55">
          Start free with 500 AI credits. Give LiTT a brief and watch it plan,
          build, and verify — the same loop you just walked through.
        </p>
        <Link
          href="/sign-up"
          className="inline-flex items-center gap-2 rounded-xl bg-[#a8ff2f] px-6 py-3 text-sm font-black text-[#03050a] transition-transform hover:scale-[1.02]"
        >
          Start building free <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
}
