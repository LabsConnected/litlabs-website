/**
 * GET /api/assets
 *
 * Canonical Asset Lake read API. Returns normalized StudioAsset records
 * from project_assets and/or user_media, scoped to the authenticated
 * user.
 *
 * Query params:
 *   projectId — filter to a specific project's assets
 *   kind      — filter by asset kind (image, video, music, audio, design, code, game)
 *   scope     — "project" | "user" | "all" (default: "all")
 *   limit     — max results (default 50, max 200)
 *
 * Security:
 *   - Authenticated users only.
 *   - Project ownership verified server-side via getProject() before
 *     any project_assets read — client-supplied projectId is NOT trusted.
 *   - user_media scoped to the authenticated user's own rows.
 *   - No demo/fake fallback data.
 *   - Invalid explicit filters are rejected with 400, not silently ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listStudioAssets } from "@/lib/assets/repository";
import { isAssetKind, type AssetKind } from "@/lib/assets/types";

export const dynamic = "force-dynamic";

const VALID_SCOPES = ["project", "user", "all"] as const;
type ValidScope = (typeof VALID_SCOPES)[number];

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId") || undefined;
  const kindParam = searchParams.get("kind") || undefined;
  const scopeParam = searchParams.get("scope") || "all";
  const limitParam = searchParams.get("limit");

  // Validate kind — reject invalid explicit values truthfully.
  let kind: AssetKind | undefined;
  if (kindParam) {
    if (!isAssetKind(kindParam)) {
      return NextResponse.json(
        { error: `Invalid kind filter: '${kindParam}'. Valid values: image, video, music, audio, design, code, game.` },
        { status: 400 },
      );
    }
    kind = kindParam;
  }

  // Validate scope — reject invalid explicit values truthfully.
  let scope: ValidScope = "all";
  if (scopeParam) {
    if (!VALID_SCOPES.includes(scopeParam as ValidScope)) {
      return NextResponse.json(
        { error: `Invalid scope: '${scopeParam}'. Valid values: project, user, all.` },
        { status: 400 },
      );
    }
    scope = scopeParam as ValidScope;
  }

  // Parse limit — reject invalid explicit values truthfully.
  let limit: number | undefined;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: `Invalid limit: '${limitParam}'. Must be a positive integer.` },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  const { assets, error } = await listStudioAssets({
    clerkId,
    projectId: projectId ?? undefined,
    kind,
    scope,
    limit,
  });

  if (error) {
    // Distinguish auth errors from config errors.
    if (error === "Authentication required.") {
      return NextResponse.json({ error }, { status: 401 });
    }
    if (error === "Database is not configured.") {
      return NextResponse.json({ error }, { status: 503 });
    }
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({
    assets,
    count: assets.length,
  });
}
