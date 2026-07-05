import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Games",
  description: "Play and discover AI-powered games and interactive experiences.",
};

export default function GamesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
