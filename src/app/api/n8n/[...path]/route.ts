/**
 * n8n Webhook Bridge — forwards authenticated requests from the public
 * Vercel app to the private n8n instance on Railway.
 *
 * Architecture:
 *   External (Stripe/GitHub/custom) → POST /api/n8n/webhook/{path}
 *     → This route authenticates via LITT_N8N_BRIDGE_SECRET header
 *     → Forwards to N8N_WEBHOOK_URL/webhook/{path}
 *     → Returns n8n's response
 *
 * n8n itself is NOT publicly accessible. Only this bridge can reach it.
 * The bridge validates a shared secret before forwarding.
 *
 * Usage from your app or external services:
 *   POST https://litlabs.ai/api/n8n/webhook/stripe-onboarding
 *   Headers: { "x-n8n-bridge-secret": "<LITT_N8N_BRIDGE_SECRET>" }
 *   Body: any JSON
 *
 * In n8n, create a Webhook node with:
 *   - Path: stripe-onboarding
 *   - Method: POST
 *   - Authentication: None (the bridge handles auth)
 */

import { NextRequest, NextResponse } from "next/server";

const BRIDGE_SECRET = process.env.LITT_N8N_BRIDGE_SECRET;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

// Allowed HTTP methods to forward
const ALLOWED_METHODS = new Set(["POST", "GET", "PUT", "PATCH", "DELETE"]);

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

  // ── Authenticate the incoming request ──
  const providedSecret = req.headers.get("x-n8n-bridge-secret");
  if (!providedSecret || providedSecret !== BRIDGE_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
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
    const body = method !== "GET" && method !== "HEAD"
      ? await req.text()
      : undefined;

    const n8nResponse = await fetch(targetUrl, {
      method,
      headers: {
        "Content-Type": req.headers.get("content-type") ?? "application/json",
      },
      body,
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
