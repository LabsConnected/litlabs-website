import Link from "next/link";
import { ArrowRight, Film } from "lucide-react";

export function RealProjectWalkthrough() {
  return (
    <section
      id="real-project-walkthrough"
      aria-labelledby="real-project-walkthrough-title"
      className="litt-section relative overflow-hidden"
    >
      <div className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[720px] -translate-x-1/2 rounded-full bg-accent/6 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-14">
          <div data-reveal className="max-w-xl">
            <div className="litt-eyebrow">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent shadow-accent-glow-strong" />
              One real project
            </div>
            <h2
              id="real-project-walkthrough-title"
              className="mt-5 text-[clamp(2.25rem,5vw,4.5rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#0E1510]"
            >
              ‘After Midnight’ — a site, <span className="litt-gradient-text">start to finish.</span>
            </h2>
            <p className="mt-5 text-base leading-7 text-[#37463A] sm:text-lg sm:leading-8">
              Follow the After Midnight artist-page project through its original prompt, real Studio files, finished page, and fresh-load checks.
            </p>
            <p className="mt-4 text-sm leading-6 text-[#63745F]">
              This is an edited walkthrough of genuine LiTT Studio captures and a direct render of the saved page. The concept page was refined after LiTT’s first build; it does not represent a real artist release.
            </p>
            <Link href="/studio" className="litt-primary-button mt-7 inline-flex">
              Start a project <ArrowRight size={16} />
            </Link>
          </div>

          <figure data-reveal className="min-w-0">
            <div className="overflow-hidden rounded-2xl border border-[#CFDEC4] bg-black shadow-[0_30px_90px_rgba(14,60,26,.22)]">
              <video
                className="block aspect-video w-full bg-black object-cover"
                controls
                playsInline
                preload="metadata"
                poster="/media/litt-project-walkthrough-poster.webp"
                width={1280}
                height={720}
                aria-label="Edited LiTT Studio walkthrough: After Midnight artist launch page"
              >
                <source src="/media/litt-project-walkthrough.mp4" type="video/mp4" />
                Your browser does not support HTML video.
              </video>
            </div>
            <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-[#63745F]">
              <span className="inline-flex items-center gap-1.5"><Film size={13} /> Real project · 27 seconds</span>
              <span>Silent, edited walkthrough · not a continuous live recording</span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
