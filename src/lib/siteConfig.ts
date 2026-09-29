/**
 * Single source of truth for the site URL.
 * Set NEXT_PUBLIC_SITE_URL in your .env.local / Vercel env vars.
 * Canonical host is www.litlabs.net — canonicals and OG URLs must never
 * use the bare litlabs.net host.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://www.litlabs.net";
