/**
 * Demo lane shared constants — safe to import from client AND server code.
 * (Kept free of `server-only` so DemoStudio.tsx can use them.)
 */

/** Exact copy shown when the anonymous message ceiling is reached. */
export const DEMO_LIMIT_MESSAGE = "Sign up to keep building with LiTT.";

/** localStorage key for the demo transcript (history carry-through signup). */
export const DEMO_TRANSCRIPT_KEY = "litt:demo:transcript";
