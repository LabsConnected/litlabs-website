/**
 * /api/assets — Canonical Asset Lake API.
 *
 * GET  — Read normalized StudioAsset records from all sources.
 * POST — Register a creator output as an asset (write seam).
 *
 * Security:
 *   - Authenticated users only.
 *   - Project ownership verified server-side via getProject() before
 *     any project_assets read — client-supplied projectId is NOT trusted.
 *   - user_media / generation_jobs / music_tracks scoped to the
 *     authenticated user's own rows.
 *   - No demo/fake fallback data.
 *   - Invalid explicit filters are rejected with 400, not silently ignored.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listStudioAssets } from "@/lib/assets/repository";
import { registerStudioAsset, isRegisterableAssetKind, type RegisterableAssetKind } from "@/lib/assets/registration";
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

/**
 * POST /api/assets
 *
 * Register a creator output as an asset in the Asset Lake.
 *
 * This is the WRITE/REGISTRATION seam for creator outputs that have
 * a durable URL but are NOT already in a source the Asset Lake can read.
 *
 * For outputs already in generation_jobs (Image) or music_tracks (Music),
 * no separate registration is needed — the READ adapters pick them up.
 *
 * Registerable kinds: image, video, music, audio.
 * design, code, and game are NOT registerable via this endpoint.
 *
 * Required fields (no fabricated provenance):
 *   kind      — image, video, music, or audio
 *   url       — durable HTTP(S) URL (blob: and data: rejected)
 *   provider  — real provider name (e.g., "fal", "veo", "gemini")
 *   model     — real model name
 *   prompt    — real generation prompt
 *
 * Optional fields:
 *   thumbnailUrl, mimeType, width, height, durationSeconds,
 *   costCredits (default 0), projectId (verified), requestId,
 *   metadata (reserved keys protected from override)
 *
 * Response:
 *   { asset: StudioAsset, replayed: boolean }
 */
export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Validate kind — must be a RegisterableAssetKind, not just any AssetKind.
  const kind = body.kind;
  if (typeof kind !== "string") {
    return NextResponse.json(
      { error: "Missing 'kind'. Registerable values: image, video, music, audio." },
      { status: 400 },
    );
  }
  if (!isRegisterableAssetKind(kind)) {
    return NextResponse.json(
      { error: `Kind '${kind}' is not registerable via POST /api/assets. Registerable values: image, video, music, audio. design, code, and game require a different persistence strategy.` },
      { status: 400 },
    );
  }

  // Validate URL — must be a durable HTTP(S) URL.
  const url = body.url;
  if (typeof url !== "string" || !url) {
    return NextResponse.json(
      { error: "Missing 'url'. Must be a durable HTTP(S) URL." },
      { status: 400 },
    );
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json(
        { error: `URL scheme '${parsed.protocol}' is not accepted. Must be HTTP(S). blob: and data: URLs are not durable.` },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid 'url'. Must be a valid HTTP(S) URL." },
      { status: 400 },
    );
  }

  // Validate required provenance — no fabrication.
  const provider = body.provider;
  if (typeof provider !== "string" || !provider) {
    return NextResponse.json(
      { error: "Missing 'provider'. Real provider name is required — no fabricated provenance." },
      { status: 400 },
    );
  }
  const model = body.model;
  if (typeof model !== "string" || !model) {
    return NextResponse.json(
      { error: "Missing 'model'. Real model name is required — no fabricated provenance." },
      { status: 400 },
    );
  }
  const prompt = body.prompt;
  if (typeof prompt !== "string" || !prompt) {
    return NextResponse.json(
      { error: "Missing 'prompt'. Real generation prompt is required — no fabricated provenance." },
      { status: 400 },
    );
  }

  // Build registration input with type-safe optional fields.
  const input = {
    kind: kind as RegisterableAssetKind,
    url,
    provider,
    model,
    prompt,
    thumbnailUrl: typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : undefined,
    mimeType: typeof body.mimeType === "string" ? body.mimeType : undefined,
    width: typeof body.width === "number" ? body.width : undefined,
    height: typeof body.height === "number" ? body.height : undefined,
    durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : undefined,
    costCredits: typeof body.costCredits === "number" ? body.costCredits : undefined,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    requestId: typeof body.requestId === "string" ? body.requestId : undefined,
    metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : undefined,
  };

  const { asset, error, replayed } = await registerStudioAsset(input, clerkId);

  if (error) {
    if (error === "Authentication required.") {
      return NextResponse.json({ error }, { status: 401 });
    }
    if (error === "Database is not configured.") {
      return NextResponse.json({ error }, { status: 503 });
    }
    if (error === "Project not found or access denied.") {
      return NextResponse.json({ error }, { status: 403 });
    }
    return NextResponse.json({ error }, { status: 400 });
  }

  return NextResponse.json({ asset, replayed }, { status: replayed ? 200 : 201 });
}
