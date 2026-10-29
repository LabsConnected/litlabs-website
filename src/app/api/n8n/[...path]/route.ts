/**
 * n8n Webhook Bridge — forwards authenticated requests from the public
 * Vercel app to the private n8n instance on Railway.
 *
 * Architecture:
 *   External (Stripe/GitHub/custom) → POST /api/n8n/webhook/{path}
 *     → This route authenticates via signed webhook (HMAC-SHA256)
 *     → Forwards to N8N_WEBHOOK_URL/webhook/{path}
 *     → Returns n8n's response
 *
 * n8n itself is NOT publicly accessible. Only this bridge can reach it.
 *
 * Authentication (two modes):
 *
 * 1. Signed webhook (preferred):
 *    Headers: x-litt-signature (HMAC-SHA256 hex), x-litt-timestamp (unix sec)
 *    Body:    JSON-serialized payload
 *    The signature is computed over the raw body using LITT_N8N_BRIDGE_SECRET.
 *    Timestamps older than 5 minutes are rejected (replay protection).
 *
 * 2. Legacy shared secret (backward compatibility):
 *    Header: x-n8n-bridge-secret: <LITT_N8N_BRIDGE_SECRET>
 *    Body:   any JSON
 *    This mode does NOT have replay protection and should be migrated.
 *
 * Usage from the LiTTree app (signed):
 *   import { sendToN8n } from "@/lib/n8n-webhook";
 *   await sendToN8n("litt-new-lead", { ...payload });
 *
 * Usage from external services (legacy):
 *   POST https://litlabs.ai/api/n8n/webhook/{path}
 *   Headers: { "x-n8n-bridge-secret": "<LITT_N8N_BRIDGE_SECRET>" }
 *   Body: any JSON
 *
 * D4 (ART-20261022-013, prepared 2026-10-22, NOT deployed):
 * After authenticating the caller, this bridge authorizes the operation
 * (single-segment path allowlist, byte payload limit) and forwards the
 * request with FRESH server-generated signing headers — a new HMAC over
 * the exact forwarded body, a new timestamp, and a unique request ID for
 * n8n-side replay protection (see src/lib/n8n-bridge-signing.ts).
 * Caller-supplied signing headers are never forwarded.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  SIGNING_VERSION_V2,
  verifyWebhookSignatureV2,
} from "@/lib/n8n-webhook";
import {
  buildForwardSigningHeaders,
  createInMemoryReplayClaim,
  exceedsPayloadLimit,
  isAuthorizedWebhookPath,
} from "@/lib/n8n-bridge-signing";
import { timingSafeEqual } from "crypto";

// One-time claim for verified v2 request IDs (replay gate). Interim
// in-process store; production swaps in the shared atomic Supabase claim
// (ART-20261022-016) without protocol changes.
const replayClaim = createInMemoryReplayClaim();

const BRIDGE_SECRET = process.env.LITT_N8N_BRIDGE_SECRET;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

// Allowed HTTP methods to forward
const ALLOWED_METHODS = new Set(["POST", "GET", "PUT", "PATCH", "DELETE"]);

function safeSecretEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return (
    candidateBuffer.length === expectedBuffer.length &&
    timingSafeEqual(candidateBuffer, expectedBuffer)
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  return handleBridge(req, params);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  return handleBridge(req, params);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  return handleBridge(req, params);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  return handleBridge(req, params);
}

/**
 * Authenticate the incoming request.
 * Returns true if the request passes signed-webhook OR legacy shared-secret auth.
 */
async function authenticateRequest(
  req: NextRequest,
  rawBody: string,
  path: string,
): Promise<{
  authenticated: boolean;
  reason?: string;
  mode?: "signed" | "legacy";
  requestId?: string;
}> {
  // ── Mode 1: Signed webhook — v2 ONLY (no silent v1 fallback) ──
  const signature = req.headers.get("x-litt-signature");
  const timestampHeader = req.headers.get("x-litt-timestamp");

  if (signature || timestampHeader) {
    if (req.headers.get("x-litt-signature-version") !== SIGNING_VERSION_V2) {
      return { authenticated: false, reason: "Unsupported signature version" };
    }
    const requestId = req.headers.get("x-litt-request-id");
    if (!signature || !timestampHeader || !requestId) {
      return { authenticated: false, reason: "Missing signing headers" };
    }
    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      return { authenticated: false, reason: "Invalid timestamp" };
    }
    // v2 binds timestamp, request ID and path into the signature: the
    // freshness window can no longer be reset by editing unsigned metadata.
    const valid = verifyWebhookSignatureV2({
      body: rawBody,
      signature,
      timestamp,
      requestId,
      path,
    });
    if (valid) {
      return { authenticated: true, mode: "signed", requestId };
    }
    return { authenticated: false, reason: "Invalid signature or expired timestamp" };
  }

  // ── Mode 2: Legacy shared secret (backward compatibility) ──
  // Not a signature fallback: a distinct auth mode for server-side callers.
  // Whatever it sends is re-signed with v2 on forward (see handleBridge).
  const providedSecret = req.headers.get("x-n8n-bridge-secret");
  if (providedSecret && BRIDGE_SECRET) {
    if (safeSecretEqual(providedSecret, BRIDGE_SECRET)) {
      return { authenticated: true, mode: "legacy" };
    }
    return { authenticated: false, reason: "Invalid bridge secret" };
  }

  return { authenticated: false, reason: "No authentication provided" };
}

async function handleBridge(
  req: NextRequest,
  params: Promise<{ path?: string[] }>,
) {
  // ── Validate configuration ──
  if (!BRIDGE_SECRET) {
    return NextResponse.json(
      { error: "Bridge not configured" },
      { status: 503 },
    );
  }
  if (!N8N_WEBHOOK_URL) {
    return NextResponse.json(
      { error: "Bridge not configured" },
      { status: 503 },
    );
  }

  // ── Validate method ──
  const method = req.method;
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405 },
    );
  }

  // ── Read the raw body once (needed for signature verification) ──
  const rawBody = method !== "GET" && method !== "HEAD"
    ? await req.text()
    : "";

  // ── Resolve the target path first: v2 binds it into the signature ──
  const { path: pathSegments } = await params;
  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json(
      { error: "Missing webhook path" },
      { status: 400 },
    );
  }
  const signingPath = pathSegments.join("/");

  // ── Authenticate ──
  const authResult = await authenticateRequest(req, rawBody, signingPath);
  if (!authResult.authenticated) {
    console.warn("[n8n-bridge] authentication failed", {
      reason: authResult.reason,
    });
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // ── D4: Authorize the operation ──
  // Only known, single-segment n8n webhook paths may be forwarded. An
  // authenticated caller is not authorized for arbitrary paths.
  if (!isAuthorizedWebhookPath(pathSegments)) {
    return NextResponse.json(
      { error: "Webhook path not authorized" },
      { status: 403 },
    );
  }
  const webhookPath = pathSegments[0];
  const targetUrl = `${N8N_WEBHOOK_URL.replace(/\/$/, "")}/webhook/${webhookPath}`;

  // ── D4: Payload limit (byte-accurate) ──
  if (exceedsPayloadLimit(rawBody)) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 },
    );
  }

  // ── Replay gate: a verified v2 request ID may be used exactly once ──
  // Claimed only after authentication + authorization + payload checks, so
  // an unauthenticated probe cannot burn a legitimate caller's request ID.
  if (authResult.mode === "signed" && authResult.requestId) {
    const claimed = await replayClaim(
      `${webhookPath}:${authResult.requestId}`,
    );
    if (!claimed) {
      return NextResponse.json(
        { error: "Replay detected" },
        { status: 401 },
      );
    }
  }

  // ── Forward the request to n8n ──
  try {
    // ── D4: Fresh server-generated signing headers ──
    // NEVER forward caller-supplied x-litt-signature / x-litt-timestamp /
    // x-litt-request-id / x-n8n-bridge-secret (or authorization/cookie).
    // The forwarded request is built from an allowlist: Content-Type plus
    // a signature the bridge generates itself, over the exact body it
    // forwards, with a fresh timestamp and a unique request ID that n8n
    // uses for replay protection.
    const signingHeaders = buildForwardSigningHeaders(BRIDGE_SECRET, rawBody, webhookPath);
    const n8nResponse = await fetch(targetUrl, {
      method,
      headers: {
        "Content-Type": req.headers.get("content-type") ?? "application/json",
        ...signingHeaders,
      },
      body: rawBody || undefined,
      // n8n webhook nodes typically respond within 30s
      signal: AbortSignal.timeout(60_000),
    });

    // ── Return n8n's response ──
    const responseHeaders = new Headers();
    const contentType = n8nResponse.headers.get("content-type");
    if (contentType) responseHeaders.set("content-type", contentType);

    const responseBody = await n8nResponse.text();
    return new NextResponse(responseBody, {
      status: n8nResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to reach n8n", detail: message },
      { status: 502 },
    );
  }
}
