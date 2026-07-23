"use client";

import type { ArtworkRatio } from "@/lib/retro-artwork";
import type { RetroSystemId } from "@/lib/retro-arcade";

const SYSTEM_PHOTOS: Record<RetroSystemId, { src: string; label: string }> = {
  nes: { src: "/images/systems/nes.png", label: "Nintendo Entertainment System" },
  snes: { src: "/images/systems/snes.png", label: "Super Nintendo Entertainment System" },
  gb: { src: "/images/systems/game-boy.jpg", label: "Nintendo Game Boy" },
  gbc: { src: "/images/systems/game-boy-color.png", label: "Nintendo Game Boy Color" },
  gba: { src: "/images/systems/game-boy-advance.png", label: "Nintendo Game Boy Advance" },
  segaMD: { src: "/images/systems/genesis.png", label: "Sega Genesis / Mega Drive" },
};

type Props = {
  system: RetroSystemId;
  title: string;
  subtitle?: string;
  accent?: string;
  ratio?: ArtworkRatio;
  customArtworkUrl?: string | null;
  className?: string;
  alt?: string;
};

export default function RetroArtwork({
  system,
  title,
  subtitle,
  accent,
  ratio = "cover",
  customArtworkUrl,
  className,
  alt,
}: Props) {
  const aspectRatio = ratio === "cover" ? "3/4" : ratio === "hero" ? "16/9" : "1/1";

  if (customArtworkUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={customArtworkUrl}
        alt={alt ?? `${title} artwork`}
        className={className}
        loading="lazy"
        decoding="async"
        style={{ aspectRatio }}
      />
    );
  }

  const photo = SYSTEM_PHOTOS[system];

  return (
    <figure
      className={`relative isolate overflow-hidden bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,.12),transparent_48%),linear-gradient(145deg,#171925,#080910)] ${className ?? ""}`}
      style={{ aspectRatio }}
      aria-label={alt ?? `${title} for ${photo.label}`}
    >
      <div className="absolute inset-x-[7%] top-[5%] bottom-[23%] flex items-center justify-center">
        {/* Public-domain hardware photography by Evan-Amos / Vanamo Media. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photo.src}
          alt={photo.label}
          className="max-h-full max-w-full object-contain drop-shadow-[0_20px_28px_rgba(0,0,0,.55)]"
          loading="lazy"
          decoding="async"
        />
      </div>
      <figcaption className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/55 px-3 py-2.5 backdrop-blur-md">
        <strong className="block truncate text-xs font-black text-white sm:text-sm">
          {title}
        </strong>
        <span className="mt-0.5 block truncate text-[9px] text-white/55">
          {subtitle || photo.label}
        </span>
      </figcaption>
      <span
        className="absolute left-2 top-2 rounded-md border border-white/10 bg-black/55 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
        style={{ color: accent || "#ffffff" }}
      >
        Real hardware
      </span>
    </figure>
  );
}
