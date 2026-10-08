import "server-only";

import { NextResponse } from "next/server";
import { getTerminalServerUrl } from "./terminal-url";

/**
 * Fail-closed terminal configuration for server code.
 *
 * With no implicit production fallback, an unconfigured deployment must
 * produce an explicit error / 503, never a request to an empty or guessed URL.
 */
export class TerminalNotConfiguredError extends Error {
  readonly status = 503;
  readonly code = "terminal_not_configured";
  constructor() {
    super(
      "Terminal server is not configured. Set TERMINAL_SERVER_INTERNAL_URL " +
        "(and NEXT_PUBLIC_TERMINAL_HTTP_URL / NEXT_PUBLIC_TERMINAL_WS_URL).",
    );
    this.name = "TerminalNotConfiguredError";
  }
}

/** Internal URL first, then the shared resolver. "" when unconfigured. */
export function resolveTerminalBaseUrl(): string {
  const internal = process.env.TERMINAL_SERVER_INTERNAL_URL?.trim();
  return (internal || getTerminalServerUrl()).replace(/\/+$/, "");
}

/** Like resolveTerminalBaseUrl(), but throws TerminalNotConfiguredError. */
export function requireTerminalBaseUrl(): string {
  const base = resolveTerminalBaseUrl();
  if (!base) throw new TerminalNotConfiguredError();
  return base;
}

/** A 503 response when the terminal is unconfigured, otherwise null. */
export function terminalNotConfiguredResponse(): NextResponse | null {
  if (resolveTerminalBaseUrl()) return null;
  const err = new TerminalNotConfiguredError();
  return NextResponse.json({ error: err.message, code: err.code }, { status: 503 });
}
