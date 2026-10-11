/**
 * Single source of truth for the site URL.
 * Set NEXT_PUBLIC_SITE_URL in your .env.local / Vercel env vars.
 * Falls back to https://www.litlabs.net (the canonical public domain) so a
 * missing env var can never leak an internal deployment domain (e.g. a
 * Railway *.up.railway.app URL) into robots.txt, sitemap.xml, canonical
 * links, or OG/Twitter metadata.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://www.litlabs.net";
