import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Plans and Pricing",
  description:
    "Compare LiTTree LabStudios plans, creative tools, AI features, credits, and workspace options.",
  path: "/pricing",
  index: true,
});

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
