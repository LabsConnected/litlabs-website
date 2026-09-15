import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Sign in",
  description: "Sign in to your LiTT AI workspace.",
  path: "/sign-in",
  index: false,
});

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
