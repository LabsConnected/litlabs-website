import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = {
  ...buildMetadata({
    title: "LiTT Retro Arcade — Play Classic Games in Your Browser",
    description:
      "Play NES, SNES, Sega Genesis, Game Boy, and GBA games right in your browser. Upload legally obtained ROMs and build your private arcade. No downloads, no uploads — everything stays local.",
    path: "/games/retro",
    index: true,
  }),
  keywords: [
    "retro arcade",
    "emulator",
    "NES",
    "SNES",
    "Sega Genesis",
    "Mega Drive",
    "Game Boy",
    "GBA",
    "browser emulator",
    "play retro games online",
  ],
};

export default function RetroArcadeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
