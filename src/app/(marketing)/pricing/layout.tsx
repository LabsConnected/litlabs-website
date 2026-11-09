import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "AI Project Operator Plans and Pricing",
  description:
    "Compare LiTT AI Project Operator plans, LiTTBits, project limits, and included builder features.",
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
