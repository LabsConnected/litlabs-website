import Image from "next/image";
import Link from "next/link";

/* ────────────────────────────────────────────────────────────────────
 * LandingOneContext — Pass 1
 *
 * Directly after the hero:
 *   "One project. One memory. Every creative tool."
 *
 * Shows LiTT as the center of the system with a visual flow:
 *   IMAGE → LiTT → VIDEO
 *          ↓
 *     ONE CONTEXT
 *          ↓
 *   FILES · TERMINAL · MEMORY
 *          ↓
 *     TEST · DEPLOY
 *
 * Then a real capability preview grid:
 *   Studio / Code / Terminal / Image / Video / Game
 *   Each with visible real content — no empty cards.
 * ──────────────────────────────────────────────────────────────────── */

const CAPABILITIES = [
  {
    title: "Studio",
    href: "/studio",
    image: "/studio/creative-engine-hero.png",
    label: "Command center",
    desc: "Plan missions, chat with LiTT, approve changes, and watch work happen in real time.",
    accent: "#a855f7",
  },
  {
    title: "Code",
    href: "/studio?tool=code",
    image: "/gallery/museum/neural-network.png",
    label: "Live editor",
    desc: "LiTT reads, writes, and tests real project files — not sandboxes, not mockups.",
    accent: "#30e7ff",
  },
  {
    title: "Terminal",
    href: "/studio?tool=terminal",
    image: "/gallery/museum/cyber-samurai.png",
    label: "Real shell",
    desc: "Structured argv execution through the hardened CommandExecutor pipeline.",
    accent: "#34d399",
  },
  {
    title: "Image",
    href: "/gallery",
    image: "/gallery/museum/neon-cyber-city.png",
    label: "AI generation",
    desc: "Generate artwork, assets, and campaign visuals inside the same workspace.",
    accent: "#f472b6",
  },
  {
    title: "Video",
    href: "/studio?tool=video",
    image: "/gallery/museum/ethereal-dreamscape.png",
    label: "Media pipeline",
    desc: "Create and process video content without leaving the LiTT workspace.",
    accent: "#f59e0b",
  },
  {
    title: "Game",
    href: "/games",
    image: "/games/artwork/xquest.png",
    label: "Playable · MIT",
    desc: "Ship interactive experiences through the LiTT Games catalog.",
    accent: "#a8ff2f",
  },
] as const;

const FLOW_NODES = [
  { label: "CODE", color: "#30e7ff" },
  { label: "IMAGE", color: "#f472b6" },
  { label: "VIDEO", color: "#f59e0b" },
] as const;

const CONTEXT_NODES = [
  { label: "FILES", color: "#30e7ff" },
  { label: "TERMINAL", color: "#34d399" },
  { label: "MEMORY", color: "#a855f7" },
] as const;

const SHIP_NODES = [
  { label: "TEST", color: "#34d399" },
  { label: "DEPLOY", color: "#f472b6" },
] as const;

export function LandingOneContext() {
  return (
    <section className="relative z-10 px-4 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        {/* ── Headlines ── */}
        <div className="mb-16 text-center">
          <h2 className="text-4xl font-black tracking-tight text-white md:text-5xl lg:text-6xl">
            One project.
          </h2>
          <h2 className="text-4xl font-black tracking-tight text-white md:text-5xl lg:text-6xl">
            One memory.
          </h2>
          <h2
            className="text-4xl font-black tracking-tight md:text-5xl lg:text-6xl"
            style={{
              background: "linear-gradient(110deg, #a855f7 0%, #34d399 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Every creative tool.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-neutral-400 md:text-lg">
            The user should not have to jump between separate AI applications to
            complete one project. LiTT is the center of the system.
          </p>
        </div>

        {/* ── System flow visualization ── */}
        <div className="mb-20 flex flex-col items-center">
          <div className="relative w-full max-w-3xl">
            {/* Top row: CODE / IMAGE / VIDEO → LiTT */}
            <div className="flex items-end justify-center gap-8 md:gap-16">
              {FLOW_NODES.map((node) => (
                <div key={node.label} className="flex flex-col items-center">
                  <div
                    className="rounded-xl border px-5 py-3 text-sm font-black tracking-wider"
                    style={{
                      borderColor: `${node.color}40`,
                      background: `${node.color}10`,
                      color: node.color,
                    }}
                  >
                    {node.label}
                  </div>
                  {/* Connector line down to LiTT */}
                  <div
                    className="mt-2 h-8 w-px"
                    style={{ background: `linear-gradient(to bottom, ${node.color}50, transparent)` }}
                  />
                </div>
              ))}
            </div>

            {/* LiTT center node */}
            <div className="relative flex flex-col items-center">
              <div
                className="relative flex items-center justify-center rounded-2xl border-2 px-10 py-5"
                style={{
                  borderColor: "#a855f7",
                  background: "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(52,211,153,0.08) 100%)",
                  boxShadow: "0 0 60px rgba(168,85,247,0.3)",
                }}
              >
                <Image
                  src="/brand/litt/litt-cutout-platform-128.webp"
                  alt="LiTT"
                  width={48}
                  height={48}
                  className="mr-3"
                />
                <span className="text-2xl font-black text-white md:text-3xl">LiTT</span>
              </div>
            </div>

            {/* Connector down */}
            <div className="mx-auto h-10 w-px bg-gradient-to-b from-violet-500/50 to-emerald-500/30" />

            {/* ONE CONTEXT */}
            <div className="flex justify-center">
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/8 px-6 py-3 text-sm font-black tracking-wider text-emerald-400">
                ONE CONTEXT
              </div>
            </div>

            {/* Connector down */}
            <div className="mx-auto h-10 w-px bg-gradient-to-b from-emerald-500/30 to-transparent" />

            {/* Context row: FILES · TERMINAL · MEMORY */}
            <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
              {CONTEXT_NODES.map((node) => (
                <div
                  key={node.label}
                  className="rounded-lg border px-4 py-2 text-xs font-bold tracking-wider"
                  style={{
                    borderColor: `${node.color}30`,
                    background: `${node.color}08`,
                    color: node.color,
                  }}
                >
                  {node.label}
                </div>
              ))}
            </div>

            {/* Connector down */}
            <div className="mx-auto mt-2 h-10 w-px bg-gradient-to-b from-transparent to-fuchsia-500/30" />

            {/* Ship row: TEST · DEPLOY */}
            <div className="flex items-center justify-center gap-6">
              {SHIP_NODES.map((node) => (
                <div
                  key={node.label}
                  className="rounded-lg border px-4 py-2 text-xs font-bold tracking-wider"
                  style={{
                    borderColor: `${node.color}30`,
                    background: `${node.color}08`,
                    color: node.color,
                  }}
                >
                  {node.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Real capability preview ── */}
        <div className="mb-6 text-center">
          <h3 className="text-2xl font-black text-white md:text-3xl">Real capabilities. Real artifacts.</h3>
          <p className="mt-2 text-sm text-neutral-500">
            Each surface below is a live product — not a mockup.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((cap) => (
            <Link
              key={cap.title}
              href={cap.href}
              className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a14] transition duration-300 hover:-translate-y-1 hover:border-white/20"
            >
              {/* Image */}
              <div className="relative h-44 overflow-hidden border-b border-white/8">
                <Image
                  src={cap.image}
                  alt={cap.title}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover transition duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a14] via-transparent to-transparent" />
                <div
                  className="absolute left-3 top-3 rounded-full border border-white/15 bg-black/65 px-3 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-white/80 backdrop-blur-xl"
                  style={{ color: cap.accent }}
                >
                  {cap.label}
                </div>
              </div>
              {/* Content */}
              <div className="flex flex-1 flex-col p-4">
                <h4 className="text-base font-black text-white">{cap.title}</h4>
                <p className="mt-1.5 text-xs leading-5 text-neutral-500">{cap.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
