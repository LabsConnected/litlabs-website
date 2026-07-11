import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Explore AI-generated images, videos, and art from the LiTT Code community.",
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
