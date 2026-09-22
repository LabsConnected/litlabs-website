/**
 * Project secrets — shared validation, fingerprinting, and field descriptors.
 *
 * Secrets are stored encrypted at rest via SecretBroker (AES-256-GCM,
 * terminal_secrets table). This module is the single place that decides
 * what a valid secret NAME looks like, how big a value may be, and how the
 * UI may describe a stored secret without ever seeing its value.
 *
 * Fingerprints are SHA-256 hashes (first 8 hex chars) of the plaintext
 * value. They let the UI show "set ••••a1b2c3d4" and detect rotation
 * without the value ever leaving the server.
 */

import { createHash } from "crypto";

/** Env-var-shaped names only: UPPER_SNAKE, max 64 chars total. */
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Refuse values larger than 16 KB — secrets are keys and tokens, not files. */
export const MAX_SECRET_VALUE_LENGTH = 16 * 1024;

/** Sanity cap so one project can't stuff the table. */
export const MAX_SECRETS_PER_PROJECT = 50;

/**
 * The Clerk subset the preview runtime needs. The store itself is general
 * (other integrations will follow); these descriptors drive the Studio UI
 * so Larry can paste exactly the two keys a Clerk workspace needs.
 */
export interface ClerkSecretField {
  name: string;
  label: string;
  placeholder: string;
  help: string;
}

export const CLERK_SECRET_FIELDS: ClerkSecretField[] = [
  {
    name: "CLERK_SECRET_KEY",
    label: "Clerk secret key",
    placeholder: "sk_live_…",
    help: "Clerk dashboard → API keys → Secret key",
  },
  {
    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    label: "Clerk publishable key",
    placeholder: "pk_live_…",
    help: "Clerk dashboard → API keys → Publishable key",
  },
];

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

export function validateSecretInput(
  name: unknown,
  value: unknown,
): { ok: true; name: string; value: string } | { ok: false; error: string } {
  if (typeof name !== "string" || !isValidSecretName(name.trim())) {
    return {
      ok: false,
      error:
        "Invalid secret name. Use UPPER_SNAKE_CASE, letters/numbers/underscores, max 64 characters.",
    };
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, error: "Value is required." };
  }
  if (value.length > MAX_SECRET_VALUE_LENGTH) {
    return {
      ok: false,
      error: `Value too long (max ${MAX_SECRET_VALUE_LENGTH / 1024} KB).`,
    };
  }
  return { ok: true, name: name.trim(), value };
}

/**
 * Short, non-reversible fingerprint of a secret value.
 * Safe to return to the client — it can never reconstruct the value.
 */
export function fingerprintSecretValue(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex").slice(0, 8);
}

/** Masked display form: "••••a1b2c3d4". */
export function maskFingerprint(fingerprint: string): string {
  return `••••${fingerprint.slice(-8)}`;
}
