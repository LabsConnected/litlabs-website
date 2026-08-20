import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { listServices, createService, type BusinessResult } from "@/lib/business-operations";

export const runtime = "nodejs";

/**
 * GET /api/business/services?activeOnly=true
 * List all business services.
 */
async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get("activeOnly") === "true";
  return toResponse(await listServices(userId, activeOnly));
}

/**
 * POST /api/business/services
 * Create a new service.
 */
async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return typedError(400, "Invalid JSON body");
  }

  return toResponse(await createService(userId, body as Parameters<typeof createService>[1]));
}

export const GET = withRateLimit(getHandler, 60, 60);
export const POST = withRateLimit(postHandler, 20, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function toResponse<T>(result: BusinessResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
