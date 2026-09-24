/**
 * Owner identity — the pure env-var check, shared across the codebase.
 *
 * Deliberately NOT "server-only": this module is a pure environment read
 * with no server dependencies, so it is safe to import from modules that
 * also flow into client bundles (e.g. mission-control.ts via dashboard
 * type imports). All privileged server-side owner logic stays in
 * @/lib/owner — that module delegates the identity check here so every
 * surface resolves "owner" through exactly one code path.
 *
 * Resolution order (canonical):
 *   1. LITTLABS_VAPI_OWNER_CLERK_ID — the platform owner's Clerk user ID
 *   2. ADMIN_CLERK_IDS — comma-separated additional admin Clerk user IDs
 */
export function isOwnerClerkId(clerkId: string | null | undefined): boolean {
  if (!clerkId) return false;
  const ownerId = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
  if (ownerId && clerkId === ownerId) return true;
  const adminIds = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return adminIds.includes(clerkId);
}
