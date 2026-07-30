import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LiTT Retro Arcade — Play Classic Games in Your Browser",
  description:
    "Play NES, SNES, Sega Genesis, Game Boy, and GBA games right in your browser. Upload legally obtained ROMs and build your private arcade. No downloads, no uploads — everything stays local.",
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
  openGraph: {
    title: "LiTT Retro Arcade — Play Classic Games in Your Browser",
    description:
      "Play NES, SNES, Sega Genesis, Game Boy, and GBA games in your browser. ROMs stay local — nothing is uploaded.",
    type: "website",
    url: "https://litlabs.net/games/retro",
    siteName: "LiTTree Lab Studios",
  },
  twitter: {
    card: "summary_large_image",
    title: "LiTT Retro Arcade — Play Classic Games in Your Browser",
    description:
      "Play NES, SNES, Sega Genesis, Game Boy, and GBA games in your browser. ROMs stay local.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: "https://litlabs.net/games/retro",
  },
};

export default function RetroArcadeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
