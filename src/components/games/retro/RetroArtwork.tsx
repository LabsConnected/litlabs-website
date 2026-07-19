"use client";

import { useMemo } from "react";
import {
  artworkDataUrl,
  type ArtworkRatio,
} from "@/lib/retro-artwork";
import type { RetroSystemId } from "@/lib/retro-arcade";

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
  const fallbackUrl = useMemo(
    () =>
      artworkDataUrl({
        system,
        title,
        subtitle,
        accent,
        ratio,
      }),
    [system, title, subtitle, accent, ratio],
  );

  const src = customArtworkUrl || fallbackUrl;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt ?? `${title} artwork`}
      className={className}
      loading="lazy"
      decoding="async"
      style={{ aspectRatio: ratio === "cover" ? "3/4" : ratio === "hero" ? "16/9" : "1/1" }}
    />
  );
}
