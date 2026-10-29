import type { Metadata } from "next";
import { requireOwnerAccess } from "@/lib/require-owner";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Server-side owner gate for /owner.
 *
 * Same canonical check as /admin/* — previously enforced by a client-side
 * NEXT_PUBLIC_ADMIN_USER_ID comparison with a hardcoded fallback, which
 * was neither authoritative nor consistent with the API routes.
 */
export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwnerAccess();
  return <>{children}</>;
}
