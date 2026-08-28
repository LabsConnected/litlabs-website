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

import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AuthError } from "./types.js";

// Browser Fetch implementations block a set of unsafe TCP ports.
// Keep automatically-selected OAuth loopback callbacks inside the
// IANA dynamic/private range so the browser can always reach them.
const MIN_BROWSER_SAFE_DYNAMIC_PORT = 49_152;
const MAX_DYNAMIC_PORT_ATTEMPTS = 32;

export interface AuthServerOptions {
  expectedState: string;
  port?: number;
  timeoutMs?: number;
  successHtml?: string;
  errorHtml?: string;
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

export function startAuthServer(options: AuthServerOptions): Promise<AuthServerHandle> {
  const {
    expectedState,
    port = 0,
    timeoutMs = 120_000,
    successHtml = DEFAULT_SUCCESS_HTML,
    errorHtml = DEFAULT_ERROR_HTML,
  } = options;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let closed = false;
  let resolveCallback!: (value: { code: string; state: string }) => void;
  let rejectCallback!: (reason: AuthError) => void;

  const callbackPromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });

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
      if (timeout) clearTimeout(timeout);
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

  return new Promise<AuthServerHandle>((resolve, reject) => {
    server.once("error", (error) => {
      reject(
        new AuthError("config", `Failed to start local auth callback server: ${error.message}`),
      );
    });

    // Bind ONLY to 127.0.0.1 — never 0.0.0.0
    let dynamicPortAttempts = 0;

    const listenForCallback = () => {
      server.listen(port, "127.0.0.1", () => {
        const address = server.address() as AddressInfo;
        const actualPort = address.port;

        // A browser performs the real OAuth redirect. When the OS
        // chooses a dynamic loopback port, keep it in the IANA
        // dynamic/private range so Fetch/browser bad-port rules
        // cannot make an otherwise healthy login intermittently fail.
        if (port === 0 && actualPort < MIN_BROWSER_SAFE_DYNAMIC_PORT) {
          dynamicPortAttempts += 1;

          if (dynamicPortAttempts >= MAX_DYNAMIC_PORT_ATTEMPTS) {
            server.close(() => {
              reject(
                new AuthError(
                  "config",
                  "Failed to obtain a browser-safe local auth callback port.",
                ),
              );
            });
            return;
          }

          server.close(() => {
            listenForCallback();
          });
          return;
        }

        const redirectUri = `http://127.0.0.1:${actualPort}/callback`;

        timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          rejectCallback(new AuthError("timeout", `OAuth callback timed out after ${timeoutMs}ms.`));
          closeListening(server);
        }, timeoutMs);

        resolve({
          port: actualPort,
          redirectUri,
          waitForCallback: () => callbackPromise,
          close: () => {
            if (timeout) clearTimeout(timeout);
            if (!settled) {
              settled = true;
              rejectCallback(new AuthError("timeout", "OAuth callback server was closed."));
            }
            closeListening(server);
          },
        });
      });
    };

    listenForCallback();
  });
}
