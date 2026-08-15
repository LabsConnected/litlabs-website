/**
 * LandingBuiltWithLiTT — examples of what LiTT can build.
 *
 * V1 spec: at least 4-6 examples across categories.
 * SaaS app, e-commerce, game, brand, music/media, dashboard.
 */

const EXAMPLES = [
  {
    category: "SaaS app",
    title: "Subscription dashboard",
    desc: "Auth, billing, user management, and a real API — built and verified end-to-end.",
    color: "#a855f7",
    emoji: "📊",
  },
  {
    category: "E-commerce",
    title: "Storefront + checkout",
    desc: "Product catalog, cart, Stripe checkout, and order tracking. Real payments, real shipping.",
    color: "#34d399",
    emoji: "🛒",
  },
  {
    category: "Game",
    title: "Browser arcade game",
    desc: "Playable in the browser. Real game loop, real physics, real score tracking — ship it.",
    color: "#f59e0b",
    emoji: "🎮",
  },
  {
    category: "Brand",
    title: "Brand identity site",
    desc: "Landing page, logo, color system, and voice — all generated, all editable, all yours.",
    color: "#ec4899",
    emoji: "🎨",
  },
  {
    category: "Music / Media",
    title: "Media publishing platform",
    desc: "Upload, transcode, and publish audio + video. CMS, player, and RSS — the full pipeline.",
    color: "#30e7ff",
    emoji: "🎵",
  },
  {
    category: "Dashboard",
    title: "Analytics dashboard",
    desc: "Real-time charts, filters, and exports. Connect any data source and visualize it live.",
    color: "#818cf8",
    emoji: "📈",
  },
];

export function LandingBuiltWithLiTT() {
  return (
    <section className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-orange-300">
            <span className="h-px w-8 bg-orange-400/40" />
            Built with LiTT
            <span className="h-px w-8 bg-orange-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            What can you build?
            <br />
            <span className="bg-gradient-to-r from-orange-300 via-pink-300 to-violet-300 bg-clip-text text-transparent">
              Anything you can describe.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            From a one-line prompt to a shipped product. Here are a few directions to start from —
            or bring your own idea.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {EXAMPLES.map((ex) => (
            <div
              key={ex.title}
              className="group relative overflow-hidden rounded-2xl border border-white/8 p-6 transition-all duration-500 hover:-translate-y-1 hover:border-white/15 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
              style={{ background: "linear-gradient(145deg, rgba(255,255,255,0.02), transparent)" }}
            >
              <div
                className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30"
                style={{ background: ex.color }}
              />
              <div className="relative">
                <div className="mb-4 flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl"
                    style={{ background: `${ex.color}14`, border: `1px solid ${ex.color}25` }}
                  >
                    {ex.emoji}
                  </div>
                  <span
                    className="rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest"
                    style={{ borderColor: `${ex.color}30`, color: ex.color, background: `${ex.color}0d` }}
                  >
                    {ex.category}
                  </span>
                </div>
                <h3 className="mb-2 text-base font-black tracking-tight text-white">{ex.title}</h3>
                <p className="text-sm leading-relaxed text-neutral-500">{ex.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
