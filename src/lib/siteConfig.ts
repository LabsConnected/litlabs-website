/**
 * Single source of truth for the site URL.
 * Set NEXT_PUBLIC_SITE_URL in your .env.local / Vercel env vars.
 * Falls back to https://litlabs.net in production.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://litlabs.net";

/** Single source of truth for the copyright year shown in site footers. */
export const SITE_COPYRIGHT_YEAR = new Date().getFullYear();

/** Public GitHub destination for footer/social links (LabsConnected org). */
export const SITE_GITHUB_URL = "https://github.com/LabsConnected";
