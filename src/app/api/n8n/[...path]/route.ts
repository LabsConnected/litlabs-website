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
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/n8n-webhook";
import { timingSafeEqual } from "crypto";

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
): Promise<{ authenticated: boolean; reason?: string }> {
  // ── Mode 1: Signed webhook (preferred) ──
  const signature = req.headers.get("x-litt-signature");
  const timestampHeader = req.headers.get("x-litt-timestamp");

  if (signature && timestampHeader) {
    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp)) {
      return { authenticated: false, reason: "Invalid timestamp" };
    }
    const valid = verifyWebhookSignature(rawBody, signature, timestamp);
    if (valid) {
      return { authenticated: true };
    }
    return { authenticated: false, reason: "Invalid signature or expired timestamp" };
  }

  // ── Mode 2: Legacy shared secret (backward compatibility) ──
  const providedSecret = req.headers.get("x-n8n-bridge-secret");
  if (providedSecret && BRIDGE_SECRET) {
    if (safeSecretEqual(providedSecret, BRIDGE_SECRET)) {
      return { authenticated: true };
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

  // ── Authenticate ──
  const authResult = await authenticateRequest(req, rawBody);
  if (!authResult.authenticated) {
    console.warn("[n8n-bridge] authentication failed", {
      reason: authResult.reason,
    });
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // ── Build the n8n webhook URL ──
  const { path: pathSegments } = await params;
  if (!pathSegments || pathSegments.length === 0) {
    return NextResponse.json(
      { error: "Missing webhook path" },
      { status: 400 },
    );
  }
  const webhookPath = pathSegments.join("/");
  const targetUrl = `${N8N_WEBHOOK_URL.replace(/\/$/, "")}/webhook/${webhookPath}`;

  // ── Forward the request to n8n ──
  try {
    const n8nResponse = await fetch(targetUrl, {
      method,
      headers: {
        "Content-Type": req.headers.get("content-type") ?? "application/json",
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
