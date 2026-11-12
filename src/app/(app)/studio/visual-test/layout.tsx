import type { Metadata } from "next";
import { requireOwnerAccess } from "@/lib/require-owner";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Server-side owner gate for /studio/visual-test — same canonical check
 * as /owner and /admin/*. The page's own client-side sign-in guard only
 * required ANY authenticated user; this is a dev QA harness, not a
 * member feature, so it needs the stricter owner-only gate (issue #627
 * Studio Merge, "test routes = internal only").
 */
export default async function VisualTestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwnerAccess();
  return <>{children}</>;
}
