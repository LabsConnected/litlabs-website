import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { listLeads, type BusinessResult, type BusinessLead } from "@/lib/business-operations";

export const runtime = "nodejs";

/**
 * GET /api/business/leads?status=new&limit=50&offset=0
 * In-Studio lead inbox: the site owner reads form submissions from
 * their published sites. Owner-authenticated — a visitor can never
 * read another site's leads.
 */
async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as BusinessLead["status"] | null;
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const offset = Number(url.searchParams.get("offset") ?? "0");

  const validStatuses: BusinessLead["status"][] = ["new", "qualified", "contacted", "converted", "lost"];

  return toResponse(
    await listLeads(userId, {
      status: status && validStatuses.includes(status) ? status : undefined,
      limit: Number.isFinite(limit) ? limit : 50,
      offset: Number.isFinite(offset) ? offset : 0,
    }),
  );
}

const rateLimitedGet = withRateLimit(getHandler, 60, 60);

export async function GET(req: NextRequest) {
  return rateLimitedGet(req);
}

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function toResponse<T>(result: BusinessResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
