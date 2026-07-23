const TESTIMONIALS = [
  {
    quote:
      "I shipped a full landing page, an agent roster, and a payments flow in one afternoon. The Director just gets it.",
    author: "Mara Voss",
    role: "Solo founder · @marabuilds",
    initial: "M",
    accent: "from-cyan-400 to-blue-500",
  },
  {
    quote:
      "LiTT's crew doesn't just chat — it writes code I can review, runs the tests, and opens the PR. That changed everything.",
    author: "Jaden Park",
    role: "Engineering lead · Cursor Days",
    initial: "J",
    accent: "from-fuchsia-400 to-pink-500",
  },
  {
    quote:
      "We replaced four SaaS tools with LiTT Studios. The agents do the work, we keep the credit.",
    author: "Nia Okafor",
    role: "Creator · 218k followers",
    initial: "N",
    accent: "from-amber-400 to-orange-500",
  },
];

export function LandingTestimonials() {
  return (
    <section className="relative z-10 border-y border-white/5 bg-white/[0.01] px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
            <span className="h-px w-8 bg-amber-400/40" />
            Loved by builders
            <span className="h-px w-8 bg-amber-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            Creators ship faster
            <br />
            <span className="bg-gradient-to-r from-amber-300 to-pink-300 bg-clip-text text-transparent">
              with their crew.
            </span>
          </h2>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.author}
              className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6 transition hover:border-white/15"
            >
              <svg
                aria-hidden
                className="absolute right-5 top-5 h-10 w-10 text-white/5"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M9 7H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2H4v2h1a4 4 0 0 0 4-4V7zm10 0h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2v2a2 2 0 0 1-2 2h-1v2h1a4 4 0 0 0 4-4V7z" />
              </svg>

              <blockquote className="relative grow text-[15px] leading-relaxed text-neutral-200">
                “{t.quote}”
              </blockquote>

              <figcaption className="mt-5 flex items-center gap-3 border-t border-white/5 pt-5">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br ${t.accent} text-sm font-black text-black`}
                >
                  {t.initial}
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{t.author}</div>
                  <div className="text-xs text-neutral-500">{t.role}</div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
