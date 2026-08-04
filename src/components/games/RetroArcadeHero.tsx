import Image from "next/image";
import Link from "next/link";

const HERO_SRC = "/images/games/litt-retro-arcade-hero.png";

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
            className="object-cover object-center"
          />
          <Link
            href="/games/retro"
            aria-label="Open Retro Arcade"
            className="absolute left-[4.2%] top-[68.5%] h-[16%] w-[17.2%] rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lime-300"
          />
          <Link
            href="/games/retro?import=1"
            aria-label="Import ROMs"
            className="absolute left-[23.4%] top-[70.5%] h-[14%] w-[14.5%] rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-purple-300"
          />
        </div>
      </div>

      {/* Visible hero caption — the text the user wants on the top page */}
      <p className="px-1 text-center text-sm font-medium leading-6 text-white/65 sm:text-base">
        LiTT Retro Arcade featuring the LiTTree mascot, supported retro systems, private ROM library, local saves, custom controls, and import actions
      </p>
    </section>
  );
}
