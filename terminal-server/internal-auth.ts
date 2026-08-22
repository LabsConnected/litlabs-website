/**
 * Internal service authentication middleware.
 *
 * Extracted from server.ts for testability. Internal endpoints
 * (under /internal/*) use a shared secret via the X-Internal-Service-Key
 * header. This is separate from the user-facing terminal JWT auth and
 * is only for Next.js → terminal-server service-to-service calls.
 */

import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  terminalUserId?: string;
  workspaceId?: string;
  workspaceRoot?: string;
}

/**
 * Middleware that requires a valid X-Internal-Service-Key header.
 *
 * - Returns 503 if TERMINAL_INTERNAL_SERVICE_KEY is not configured (< 32 chars)
 * - Returns 401 if the header is missing or doesn't match (timing-safe comparison)
 * - Calls next() on success
 */
export function requireInternalServiceAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const expectedKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
  if (expectedKey.length < 32) {
    res.status(503).json({ error: "Internal service auth not configured" });
    return;
  }
  const providedKey = req.headers["x-internal-service-key"] as string | undefined;
  if (!providedKey || providedKey.length !== expectedKey.length) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Timing-safe comparison
  const a = Buffer.from(providedKey);
  const b = Buffer.from(expectedKey);
  if (a.length !== b.length || !a.equals(b)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
