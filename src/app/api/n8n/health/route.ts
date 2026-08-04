/**
 * n8n Health Check Endpoint — admin only.
 *
 * Checks whether the n8n integration is configured and reachable.
 * Does NOT expose n8n credentials, editor URLs, or internal details.
 *
 * Response shape:
 *   { configured: boolean, reachable: boolean, responseTime?: number }
 *
 * Auth: requires admin (canMutateBalances — admin role or internal API key).
 */

import { NextRequest, NextResponse } from "next/server";
import { canMutateBalances } from "@/lib/authz";

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

interface HealthResponse {
  configured: boolean;
  reachable: boolean;
  responseTime?: number;
}

export async function GET(req: NextRequest) {
  // ── Admin-only auth ──
  const allowed = await canMutateBalances(req);
  if (!allowed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Check configuration ──
  const configured = Boolean(N8N_WEBHOOK_URL);

  if (!configured) {
    const body: HealthResponse = { configured: false, reachable: false };
    return NextResponse.json(body);
  }

  // ── Ping n8n's /healthz endpoint ──
  const healthUrl = `${N8N_WEBHOOK_URL!.replace(/\/$/, "")}/healthz`;
  const start = Date.now();

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(5_000),
    });
    const responseTime = Date.now() - start;
    const reachable = res.ok;

    const body: HealthResponse = {
      configured: true,
      reachable,
      responseTime,
    };
    return NextResponse.json(body);
  } catch {
    const responseTime = Date.now() - start;
    const body: HealthResponse = {
      configured: true,
      reachable: false,
      responseTime,
    };
    return NextResponse.json(body);
  }
}
