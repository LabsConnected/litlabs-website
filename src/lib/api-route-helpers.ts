/**
 * Server-side helpers for API route handlers.
 *
 * Ensures every API route returns structured JSON errors (never an HTML
 * error page) and emits a consistent `x-request-id` header for diagnostics.
 *
 * Usage:
 *   import { jsonError, newRequestId, jsonHeaders } from "@/lib/api-route-helpers";
 *
 *   export async function POST(req: NextRequest) {
 *     const requestId = newRequestId();
 *     try {
 *       // ... handler logic ...
 *       return NextResponse.json({ ok: true }, { headers: jsonHeaders(requestId) });
 *     } catch (err) {
 *       return jsonError(500, "Internal server error", requestId, err);
 *     }
 *   }
 */

import { NextResponse } from "next/server";

/**
 * Generate a short, unique request ID.
 * Format: `req_<base36 timestamp>_<random>`. URL-safe, no PII.
 */
export function newRequestId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `req_${ts}_${rand}`;
}

/**
 * Standard JSON response headers, including the request ID and no-store cache.
 */
export function jsonHeaders(requestId?: string, extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
  };
  if (requestId) headers["X-Request-Id"] = requestId;
  if (extra) {
    const merged = new Headers(extra);
    merged.forEach((v, k) => { headers[k] = v; });
  }
  return headers;
}

/**
 * Return a structured JSON error response.
 *
 * - Always sets `Content-Type: application/json` (never HTML).
 * - Includes the `X-Request-Id` header for client-side diagnostics.
 * - Logs the error server-side with the request ID for correlation.
 * - Never leaks stack traces or internal details to the client.
 *
 * @param status HTTP status code (4xx/5xx)
 * @param message User-safe error message
 * @param requestId Request ID for correlation
 * @param err Original error (logged server-side only, never sent to client)
 * @param code Optional machine-readable error code
 */
export function jsonError(
  status: number,
  message: string,
  requestId: string,
  err?: unknown,
  code?: string,
): NextResponse {
  // Log server-side with correlation ID. Never include the raw error in the
  // response body — that's how HTML/stack traces leak to the client.
  if (status >= 500) {
    const detail = err instanceof Error ? err.stack ?? err.message : String(err ?? "");
    console.error(`[api] ${requestId} ${status}: ${message}\n${detail}`);
  } else if (err) {
    console.warn(`[api] ${requestId} ${status}: ${message}`);
  }

  return NextResponse.json(
    {
      success: false,
      requestId,
      error: message,
      code: code ?? defaultCodeForStatus(status),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

/**
 * Wrap an async route handler with a top-level try/catch that always returns
 * a JSON error (never lets an unhandled exception bubble up as an HTML 500).
 *
 * The wrapped handler receives the request and a fresh requestId.
 */
export function withApiHandler(
  handler: (req: Request, requestId: string) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const requestId = newRequestId();
    try {
      return await handler(req, requestId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return jsonError(500, message, requestId, err);
    }
  };
}

function defaultCodeForStatus(status: number): string {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 402) return "PAYMENT_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502) return "BAD_GATEWAY";
  if (status === 503) return "SERVICE_UNAVAILABLE";
  if (status === 504) return "GATEWAY_TIMEOUT";
  return "INTERNAL_ERROR";
}
