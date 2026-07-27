import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Creator Community",
  description:
    "Share creations, meet collaborators, remix public projects, and build your creative world with the LiTTree community.",
  path: "/social",
  index: true,
});

export default function SocialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
