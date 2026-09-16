import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  getBusinessProfileForProject,
  saveBusinessProfileForProject,
} from "@/lib/business-profile-server";
import { validateBusinessProfile } from "@/lib/business-profile";

/**
 * GET /api/studio-projects/[projectId]/business-profile
 * Returns the project's persisted Business Profile, or { profile: null }.
 * Ownership is verified (id + user_id); unknown/foreign projects read as null.
 */
async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { userId } = await auth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { projectId } = await params;
    const profile = await getBusinessProfileForProject(projectId, userId);
    return NextResponse.json({ profile });
  } catch {
    return NextResponse.json(
      { error: "Failed to load business profile" },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/studio-projects/[projectId]/business-profile
 * Creates or replaces the project's Business Profile. The payload is
 * validated + sanitized (unknown fields dropped, overlong strings
 * truncated, malformed email/phone dropped with notes in `errors`).
 * Returns 404 for unknown/foreign projects (ownership check).
 */
async function putHandler(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { userId } = await auth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { projectId } = await params;

    const body = await req.json().catch(() => null);
    const precheck = validateBusinessProfile(body);
    if (Object.keys(precheck.profile).length === 0 && precheck.errors.length > 0) {
      return NextResponse.json(
        { error: "No valid profile fields", errors: precheck.errors },
        { status: 400 },
      );
    }

    const result = await saveBusinessProfileForProject(projectId, userId, body);
    if (!result) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ profile: result.profile, errors: result.errors });
  } catch {
    return NextResponse.json(
      { error: "Failed to save business profile" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const PUT = withRateLimit(putHandler, 60, 60);
