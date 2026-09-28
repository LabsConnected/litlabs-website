/**
 * LiTT Verification Foundation — hashing utilities.
 * Pure: node:crypto only.
 */
import { createHash } from "node:crypto";

/** sha256 hex digest of a UTF-8 string. */
export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** sha256 hex digest of raw bytes. */
export function sha256Bytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Canonical JSON serialization for hashing: stable key order, no whitespace.
 * Two semantically identical payloads hash identically.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    );
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** sha256 hex digest of a payload's canonical JSON form. */
export function hashPayload(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

/** Verify that `payload` matches an expected sha256 digest. */
export function verifyPayloadHash(payload: unknown, expectedSha256: string): boolean {
  if (!expectedSha256 || typeof expectedSha256 !== "string") return false;
  const actual = hashPayload(payload);
  return hashesEqual(actual, expectedSha256);
}

/** Constant-time hex digest comparison. */
export function hashesEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return timingSafeEqualHex(a, b);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
