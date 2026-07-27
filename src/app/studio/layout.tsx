import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // AutonomicLoopBanner is rendered INSIDE StudioOS as a shrink-0 child
  // of the h-dvh shell. Rendering it here (outside the h-dvh shell) caused
  // the composer to be clipped by ~36px at the bottom of the viewport.
  return <>{children}</>;
}
