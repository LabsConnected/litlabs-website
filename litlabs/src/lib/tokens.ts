// src/lib/tokens.ts
// Core utilities for generating and hashing invite codes and API keys.
// Uses Node.js crypto — server-side only.

import { createHash, randomBytes } from "crypto";

/**
 * Hash any token/code with SHA-256.
 * This is what gets stored in the database — never the raw value.
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Generate a human-friendly invite code.
 * Format: LIT-XXXX-XXXX (uppercase alphanumeric, no ambiguous chars)
 */
export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  const segment = (len: number) =>
    Array.from({ length: len }, () => chars[randomBytes(1)[0] % chars.length]).join("");
  return `LIT-${segment(4)}-${segment(4)}`;
}

/**
 * Generate a secure API key.
 * Format: lit_live_<32 random hex chars>
 * Returns both the raw key (show once) and its hash (store in DB).
 */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const hex = randomBytes(20).toString("hex"); // 40 hex chars
  const raw = `lit_live_${hex}`;
  const prefix = `lit_live_${hex.slice(0, 4)}`; // visible prefix for display
  const hash = hashToken(raw);
  return { raw, hash, prefix };
}

/**
 * Extract a Bearer token from an Authorization header.
 * Returns null if missing or malformed.
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}
