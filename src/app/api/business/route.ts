import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  getDashboard,
  getBusinessConfig,
  updateBusinessConfig,
  listServices,
  createService,
  type BusinessResult,
} from "@/lib/business-operations";

export const runtime = "nodejs";

/**
 * GET /api/business
 * Returns the business dashboard + config summary.
 */
async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  const [dashboard, config] = await Promise.all([
    getDashboard(userId),
    getBusinessConfig(userId),
  ]);

  return NextResponse.json({
    dashboard: dashboard.ok ? dashboard.data : null,
    config: config.ok ? config.data : null,
  });
}

/**
 * PUT /api/business/config
 * Updates the business configuration.
 */
async function putConfigHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return typedError(400, "Invalid JSON body");
  }

  const result = await updateBusinessConfig(userId, body as Parameters<typeof updateBusinessConfig>[1]);
  return toResponse(result);
}

export const GET = withRateLimit(getHandler, 60, 60);
export const PUT = withRateLimit(putConfigHandler, 20, 60);

// ─── Helpers ────────────────────────────────────────────────────────

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function toResponse<T>(result: BusinessResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
