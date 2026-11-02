/**
 * Feature flags for mobile — gates new, unverified behavior behind an
 * explicit opt-in so existing working flows are never changed by
 * default. Flip EXPO_PUBLIC_ENABLE_CLERK_AUTH=true in .env.local once
 * Clerk sign-in has been verified; until then the app behaves exactly
 * as it did before this change.
 */
export function isClerkAuthEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ENABLE_CLERK_AUTH === "true";
}
