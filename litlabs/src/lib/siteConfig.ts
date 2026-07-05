/**
 * Single source of truth for the site URL.
 * Set NEXT_PUBLIC_SITE_URL in your .env.local / Vercel env vars.
 * Falls back to https://litlabs.net in production.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://litlabs.net";
