import "server-only";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { isOwnerClerkId } from "@/lib/owner-identity";

/**
 * Server-side owner/admin gate for page segments.
 *
 * Resolves the request's Clerk user and requires the canonical owner
 * identity (LITTLABS_VAPI_OWNER_CLERK_ID or ADMIN_CLERK_IDS — see
 * @/lib/owner-identity). Non-owners get a 404 — the same response an
 * unauthenticated scanner gets for a route that does not exist — so the
 * admin surface stays unlisted. Returns the authorized userId.
 */
export async function requireOwnerAccess(): Promise<string> {
  const { userId } = await auth();
  if (!isOwnerClerkId(userId)) notFound();
  return userId as string;
}
