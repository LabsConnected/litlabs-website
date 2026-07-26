import Image from "next/image";
import Link from "next/link";

const HERO_SRC = "/images/games/litt-retro-arcade-hero.svg";

export function RetroArcadeHero({ variant = "full" }: { variant?: "full" | "banner" }) {
  return (
    <section className="space-y-4" aria-labelledby="retro-arcade-title">
      <h1 id="retro-arcade-title" className="sr-only">
        LiTT Retro Arcade
      </h1>
      <p className="sr-only">
        Import legal ROM files, play supported systems in your browser, and keep saves locally.
      </p>

      <div className="relative overflow-hidden rounded-3xl border border-purple-500/30 bg-black">
        <div
          className={`relative w-full ${
            variant === "banner"
              ? "aspect-3/1 min-h-65 sm:min-h-75 lg:min-h-95"
              : "aspect-3/1 min-h-70 sm:min-h-85 lg:min-h-105"
          }`}
        >
          <Image
            src={HERO_SRC}
            alt="LiTT Retro Arcade featuring the LiTTree mascot, supported retro systems, private ROM library, local saves, custom controls, and import actions"
            fill
            priority
            sizes="(max-width: 768px) 100vw, (max-width: 1440px) 92vw, 1400px"
            className="object-cover object-center sm:object-center"
          />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-r from-black/30 via-transparent to-transparent" />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/games/retro"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-lime-400 px-5 py-3 font-semibold text-black transition hover:bg-lime-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
        >
          Open Retro Arcade
        </Link>
        <Link
          href="/games/retro?import=1"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-purple-400/70 bg-black/40 px-5 py-3 font-semibold text-white backdrop-blur transition hover:bg-purple-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
        >
          Import ROMs
        </Link>
      </div>
    </section>
  );
}
