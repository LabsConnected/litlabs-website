import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gallery Retired",
  robots: { index: false, follow: false },
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
