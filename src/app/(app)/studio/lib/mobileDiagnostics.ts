"use client";

/**
 * TEMPORARY mobile Studio diagnostics.
 *
 * Purpose: isolate a real-phone Studio failure into one of six layers
 * (auth, project/workspace, chat API request, streaming, composer/input,
 * viewport/keyboard) when the tester has no attached devtools console.
 * Safe by construction: only category/event names and small primitive
 * detail values are recorded — see `redact()`. Remove this module and its
 * call sites once mobile Studio is confirmed working end-to-end on device.
 */

export type MobileDiagCategory =
  | "auth"
  | "project"
  | "chat_api"
  | "streaming"
  | "composer"
  | "viewport";

export interface MobileDiagEntry {
  /** ms since navigation start */
  t: number;
  category: MobileDiagCategory;
  event: string;
  detail?: Record<string, unknown>;
}

type DiagDetailValue = number | boolean | null | string;

const RING_SIZE = 60;
const ring: MobileDiagEntry[] = [];
const listeners = new Set<() => void>();

const MAX_STRING_LEN = 40;

/**
 * Reduce every detail value to something safe to display or copy:
 * - numbers/booleans/null pass through unchanged.
 * - strings longer than MAX_STRING_LEN collapse to a length marker so
 *   accidental message/token/content text can never leak through here.
 * - anything else (objects, arrays, functions) is dropped entirely.
 */
function redact(detail?: Record<string, DiagDetailValue>): Record<string, DiagDetailValue> | undefined {
  if (!detail) return undefined;
  const out: Record<string, DiagDetailValue> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = value.length > MAX_STRING_LEN ? `<len:${value.length}>` : value;
    }
    // silently drop anything else (objects/arrays/functions) — never
    // stringify unknown shapes, they could carry secrets or content.
  }
  return out;
}

export function mobileDiag(
  category: MobileDiagCategory,
  event: string,
  detail?: Record<string, DiagDetailValue>,
): void {
  const entry: MobileDiagEntry = {
    t: Math.round(typeof performance !== "undefined" ? performance.now() : Date.now()),
    category,
    event,
    detail: redact(detail),
  };
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  if (process.env.NODE_ENV !== "production") {
    console.info(`[MobileDiag:${category}] ${event}`, entry.detail ?? "");
  }
  listeners.forEach((fn) => fn());
}

export function getMobileDiagLog(): MobileDiagEntry[] {
  return [...ring];
}

export function subscribeMobileDiag(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function formatMobileDiagLog(): string {
  return ring
    .map((e) => `${e.t}ms [${e.category}] ${e.event}${e.detail ? " " + JSON.stringify(e.detail) : ""}`)
    .join("\n");
}

if (typeof window !== "undefined") {
  (window as unknown as { __mobileDiagDump?: () => string }).__mobileDiagDump = formatMobileDiagLog;
}
