import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Sign Up",
  description: "Create your free LiTT account. No credit card required.",
  path: "/sign-up",
  index: false,
});

export default function NoIndexLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
