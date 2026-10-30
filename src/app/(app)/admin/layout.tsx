import type { Metadata } from "next";
import { requireOwnerAccess } from "@/lib/require-owner";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Server-side admin gate for every /admin/* page.
 *
 * Authorization is enforced here — before any client component renders —
 * using the canonical owner identity (@/lib/owner-identity). The client
 * pages below still keep their signed-in loading states for UX, but they
 * are no longer the security boundary.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwnerAccess();
  return <>{children}</>;
}
