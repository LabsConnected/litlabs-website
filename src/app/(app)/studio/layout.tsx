import type { Metadata } from "next";

export const metadata: Metadata = {
  // The product name, used consistently (Studio Finish Spec, Larry
  // 2026-11-14): this surface is "LiTT Studio".
  title: "LiTT Studio",
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
  return <>{children}</>;
}
