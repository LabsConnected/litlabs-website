import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Gamepad2, ImageIcon, Palette } from "lucide-react";

/**
 * Repository-backed product/media proof. These are deliberately not presented
 * as customer projects. Each card identifies its real source and status.
 */

interface ProductSurface {
  href: string;
  title: string;
  description: string;
  image: string;
  label: string;
  source: string;
  icon: typeof Palette;
  accent: string;
}

const SURFACES: ProductSurface[] = [
  {
    href: "/studio",
    title: "Creative Engine",
    description: "Official repository artwork for LiTT's image, video, audio, and campaign creation toolset inside Studio.",
    image: "/studio/creative-engine-hero.png",
    label: "Official Studio media",
    source: "LiTTree Studio",
    icon: Palette,
    accent: "#b58cff",
  },
  {
    href: "/gallery",
    title: "Neon Cyber City",
    description: "A LiTTree LabStudios internal gallery sample used to exercise the real image and gallery pipeline.",
    image: "/gallery/museum/neon-cyber-city.png",
    label: "Internal media sample",
    source: "LiTTree demo gallery",
    icon: ImageIcon,
    accent: "#65f4ff",
  },
  {
    href: "/games",
    title: "XQuest in LiTT Games",
    description: "A playable open-source title available through the LiTT Games catalog, with original MIT attribution preserved.",
    image: "/games/artwork/xquest.png",
    label: "Playable · Open source",
    source: "Scott Rippey · MIT",
    icon: Gamepad2,
    accent: "#a8ff2f",
  },
];

export function RealCreations() {
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {SURFACES.map((surface) => {
        const Icon = surface.icon;
        return (
          <article
            key={surface.title}
            className="group flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#0a0d14] transition duration-300 hover:-translate-y-1 hover:border-white/25"
          >
            <div className="relative h-52 overflow-hidden border-b border-white/8">
              <Image src={surface.image} alt={surface.title} fill sizes="(max-width: 1024px) 100vw, 33vw" className="object-cover transition duration-700 group-hover:scale-[1.03]" />
              <div className="absolute inset-0 bg-linear-to-t from-[#0a0d14] via-transparent to-transparent" />
              <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/65 px-3 py-1.5 text-[9px] font-black uppercase tracking-[.12em] text-white/80 backdrop-blur-xl"><Icon size={11} style={{ color: surface.accent }} />{surface.label}</div>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h3 className="text-lg font-black text-white">{surface.title}</h3>
              <p className="mt-2 text-xs leading-5 text-white/50">{surface.description}</p>
              <div className="mt-4 text-[10px] font-bold text-white/40">Source: {surface.source}</div>
              <Link href={surface.href} className="mt-5 inline-flex items-center gap-2 text-xs font-black" style={{ color: surface.accent }}>Open product surface <ArrowUpRight size={13} /></Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
