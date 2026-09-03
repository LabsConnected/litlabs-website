/**
 * One-shot OAuth callback server — listens on 127.0.0.1:{ephemeralPort}.
 *
 * Security:
 *   - Binds ONLY to 127.0.0.1 (never 0.0.0.0 — no network exposure)
 *   - Validates CSRF state before accepting the authorization code
 *   - Responds to the browser BEFORE resolving the promise (so the user
 *     sees the success page, not a hang)
 *   - One-request only — closes after the first callback
 *   - Timeout protection (default 2 min)
 *
 * The redirect URI registered in Clerk is http://127.0.0.1/callback.
 * At runtime we send http://127.0.0.1:{actualPort}/callback — Clerk
 * accepts loopback callbacks with dynamic ports per RFC 8252 §7.3.
 */

import { randomInt } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AuthError } from "./types.js";

// Browser Fetch implementations block a set of unsafe TCP ports.
// Keep automatically-selected OAuth loopback callbacks inside the
// IANA dynamic/private range so the browser can always reach them.
//
// We must CHOOSE a port in this range rather than call listen(0) and
// hope the OS picks one: Windows' TCP dynamic range starts at 1024 and
// is handed out sequentially, so consecutive listen(0) calls return
// consecutive low ports and a "retry until it lands high" loop can
// never make progress.
const MIN_BROWSER_SAFE_DYNAMIC_PORT = 49_152;
const MAX_BROWSER_SAFE_DYNAMIC_PORT = 65_535;
const MAX_PORT_BIND_ATTEMPTS = 64;

// A candidate may be occupied by another process, or carved out of the
// bindable space entirely (Windows excluded port ranges report EACCES).
// Both simply mean "try the next candidate".
const RETRYABLE_BIND_CODES = new Set(["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"]);

export interface AuthServerOptions {
  expectedState: string;
  port?: number;
  timeoutMs?: number;
  successHtml?: string;
  errorHtml?: string;
  /**
   * @internal Test seam. Exact candidate ports to attempt, in order,
   * instead of sampling the browser-safe dynamic range. Production
   * callers leave this unset.
   */
  portCandidates?: readonly number[];
}

/** Uniformly sample the IANA dynamic/private range. */
function randomBrowserSafePort(): number {
  return randomInt(MIN_BROWSER_SAFE_DYNAMIC_PORT, MAX_BROWSER_SAFE_DYNAMIC_PORT + 1);
}

function isBrowserSafePort(port: number): boolean {
  return port >= MIN_BROWSER_SAFE_DYNAMIC_PORT && port <= MAX_BROWSER_SAFE_DYNAMIC_PORT;
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
}

/**
 * Bind a single candidate port on 127.0.0.1. Resolves with the bound
 * port, or rejects with the underlying listen error so the caller can
 * decide whether that error is worth another candidate.
 */
function listenOnce(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve((server.address() as AddressInfo).port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    // Bind ONLY to 127.0.0.1 — never 0.0.0.0
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Deterministically acquire a browser-safe loopback callback port.
 *
 * An explicit port is honoured exactly once (the caller asked for it,
 * so a conflict is a real error). Otherwise we probe candidates drawn
 * from the browser-safe range until one binds, with a finite bound.
 */
async function bindCallbackPort(
  server: Server,
  explicitPort: number,
  candidates: readonly number[] | undefined,
): Promise<number> {
  if (explicitPort !== 0) {
    try {
      return await listenOnce(server, explicitPort);
    } catch (error) {
      throw new AuthError(
        "config",
        `Failed to bind local auth callback port ${explicitPort}: ${errorCode(error)}.`,
      );
    }
  }

  const attempts = candidates?.length ?? MAX_PORT_BIND_ATTEMPTS;
  let lastCode = "UNKNOWN";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = candidates ? candidates[attempt] : randomBrowserSafePort();
    try {
      return await listenOnce(server, candidate);
    } catch (error) {
      lastCode = errorCode(error);
      if (!RETRYABLE_BIND_CODES.has(lastCode)) {
        throw new AuthError(
          "config",
          `Failed to start local auth callback server: ${(error as Error).message}`,
        );
      }
    }
  }

  throw new AuthError(
    "config",
    `Failed to obtain a browser-safe local auth callback port after ${attempts} attempts (last error: ${lastCode}).`,
  );
}

export interface AuthServerHandle {
  port: number;
  redirectUri: string;
  waitForCallback(): Promise<{ code: string; state: string }>;
  close(): void;
}

const DEFAULT_SUCCESS_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>LiTT — Authentication complete</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e0e0e0}h1{color:#a855f7}</style>
</head>
<body><div style="text-align:center"><h1>LiTT</h1><p>Authentication complete.</p><p>You can close this tab and return to your terminal.</p></div></body>
</html>`;

const DEFAULT_ERROR_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>LiTT — Authentication failed</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e0e0e0}h1{color:#ef4444}</style>
</head>
<body><div style="text-align:center"><h1>LiTT</h1><p>Authentication failed.</p><p>Return to your terminal for details.</p></div></body>
</html>`;

export async function startAuthServer(options: AuthServerOptions): Promise<AuthServerHandle> {
  const {
    expectedState,
    port = 0,
    timeoutMs = 120_000,
    successHtml = DEFAULT_SUCCESS_HTML,
    errorHtml = DEFAULT_ERROR_HTML,
    portCandidates,
  } = options;

  const timeoutHolder: { current: ReturnType<typeof setTimeout> | undefined } = { current: undefined };
  let settled = false;
  let closed = false;
  let resolveCallback!: (value: { code: string; state: string }) => void;
  let rejectCallback!: (reason: AuthError) => void;

  const callbackPromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

  // close() and the timeout both reject this promise. A caller that
  // never calls waitForCallback() (it closed early, or startAuthServer
  // failed) must not turn that into an unhandled rejection — so keep a
  // permanent no-op handler attached. waitForCallback() returns this
  // same promise, so real callers still observe the rejection.
  callbackPromise.catch(() => {});

  const closeListening = (server: Server) => {
    if (closed) return;
    closed = true;
    server.close();
  };

  const server = createServer((req, res) => {
    if (settled) {
      res.writeHead(410, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Authentication callback already handled.");
      return;
    }

    if (req.method !== "GET" || !req.url) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("LiTT auth server is waiting for /callback.");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description") ?? error;

    const settle = (statusCode: number, html: string, errorToReject?: AuthError) => {
      settled = true;
      if (timeoutHolder.current) clearTimeout(timeoutHolder.current);
      res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
      // Respond to the browser FIRST, then resolve/reject inside res.end()
      res.end(html, () => {
        if (errorToReject) {
          rejectCallback(errorToReject);
        } else if (code && state) {
          resolveCallback({ code, state });
        }
        closeListening(server);
      });
    };

    if (error) {
      settle(
        400,
        errorHtml,
        new AuthError("token_exchange", `OAuth authorization failed: ${errorDescription ?? "unknown error"}`),
      );
      return;
    }

    // ─── CSRF state validation ────────────────────────────────────
    if (state !== expectedState) {
      settle(400, errorHtml, new AuthError("state_mismatch", "OAuth callback state did not match."));
      return;
    }

    if (!code) {
      settle(
        400,
        errorHtml,
        new AuthError("token_exchange", "OAuth callback did not include an authorization code."),
      );
      return;
    }

    settle(200, successHtml);
  });

  const actualPort = await bindCallbackPort(server, port, portCandidates);

  // Defence in depth: never hand the browser a redirect URI on a port
  // outside the range we promised to select from.
  if (port === 0 && !isBrowserSafePort(actualPort)) {
    await new Promise<void>((done) => server.close(() => done()));
    throw new AuthError(
      "config",
      `Local auth callback bound to non-browser-safe port ${actualPort}.`,
    );
  }

  const redirectUri = `http://127.0.0.1:${actualPort}/callback`;

  timeoutHolder.current = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCallback(new AuthError("timeout", `OAuth callback timed out after ${timeoutMs}ms.`));
    closeListening(server);
  }, timeoutMs);

  // Any post-bind socket error (a dropped connection, a peer reset)
  // must not reach Node's unhandled-'error' path and kill the process.
  server.on("error", () => {
    if (settled) return;
    settled = true;
    if (timeoutHolder.current) clearTimeout(timeoutHolder.current);
    rejectCallback(new AuthError("config", "Local auth callback server failed."));
    closeListening(server);
  });

  return {
    port: actualPort,
    redirectUri,
    waitForCallback: () => callbackPromise,
    close: () => {
      if (timeoutHolder.current) clearTimeout(timeoutHolder.current);
      if (!settled) {
        settled = true;
        rejectCallback(new AuthError("timeout", "OAuth callback server was closed."));
      }
      closeListening(server);
    },
  };
}
