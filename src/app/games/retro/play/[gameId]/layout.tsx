import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Playing — LiTT Retro Arcade",
  description:
    "Private emulator session. ROMs are loaded locally in your browser and never uploaded.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RetroPlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}