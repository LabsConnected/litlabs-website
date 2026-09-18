/**
 * POST /api/media/generate — thin HTTP adapter over the shared image service.
 *
 * Auth is validated HERE, at the HTTP boundary, from the Clerk session.
 * The resolved userId is passed to the shared service as trusted
 * server-side context — the service never reads a user ID from the
 * request body (there is no userId field on the input type).
 *
 * The Studio agent image.generate tool does NOT call this route: it has
 * no Clerk session, so it calls the shared service directly with the
 * approved operation's trusted context. (The pre-2026-09-18
 * X-Internal-Service-Key self-fetch architecture was removed because it
 * layered header auth over an unauthenticated server-to-server call
 * instead of fixing the auth boundary.)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  MEDIA_PROVIDERS,
  type MediaFormat,
  type MediaProviderId,
} from "@/lib/media";
import {
  generateImage,
  type ImageGenerationResult,
} from "@/lib/generation/image-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Handled domain failures must never use gateway statuses (502/503/504).
 * Those codes tell the edge "the application itself is unreachable" —
 * Cloudflare/Railway then intercept the response and serve a branded HTML
 * error page instead of this JSON body. Verified in production 2026-09-18:
 * the app logged `status=502` with the structured PROVIDER_ERROR body, and
 * the client received Cloudflare's HTML 502 page (no x-railway-request-id,
 * i.e. edge-generated). The structured error never reached the user.
 *
 * Non-gateway statuses preserve both the failure signal (res.ok === false)
 * and the machine-readable `code` field the client actually branches on.
 */
function statusForCode(result: ImageGenerationResult): number {
  if (result.success) return 200;
  switch (result.code) {
    case "UNAUTHORIZED":
      return 401;
    case "BAD_REQUEST":
    case "UNKNOWN_PROVIDER":
    case "FORMAT_NOT_SUPPORTED":
      return 400;
    case "INSUFFICIENT_FUNDS":
      return 402;
    case "DUPLICATE_IN_FLIGHT":
      return 409;
    case "NO_PROVIDER":
      // Provider/config condition — 422 keeps the JSON body reachable
      // through edge proxies that substitute their own page on 503.
      return 422;
    case "QUOTA_EXCEEDED":
      return 429;
    case "PROVIDER_ERROR":
      // Upstream provider failure — NOT 502: an app-emitted 502 is
      // indistinguishable from a real gateway failure at the edge.
      return 422;
    default:
      return 500;
  }
}

async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        requestId: "",
        providerId: null,
        code: "UNAUTHORIZED",
        error: "Sign in to generate media",
        retryable: false,
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        requestId: "",
        providerId: null,
        code: "BAD_REQUEST",
        error: "Invalid request body — send JSON",
        retryable: false,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await generateImage(
    {
      userId,
      requestId:
        typeof body.requestId === "string" && body.requestId
          ? body.requestId
          : undefined,
    },
    {
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      negativePrompt:
        typeof body.negativePrompt === "string" ? body.negativePrompt : undefined,
      width: typeof body.width === "number" ? body.width : undefined,
      height: typeof body.height === "number" ? body.height : undefined,
      providerId: body.providerId as MediaProviderId | undefined,
      format: body.format as MediaFormat | undefined,
      aspectRatio:
        typeof body.aspectRatio === "string" ? body.aspectRatio : undefined,
      imageSize:
        body.imageSize === "1K" ||
        body.imageSize === "2K" ||
        body.imageSize === "4K"
          ? body.imageSize
          : undefined,
      seed: typeof body.seed === "number" ? body.seed : undefined,
      referenceUrl:
        typeof body.referenceUrl === "string" ? body.referenceUrl : undefined,
      generationMode:
        body.generationMode === "auto-free" ||
        body.generationMode === "auto-quality"
          ? body.generationMode
          : "manual",
    },
  );

  const status = statusForCode(result);
  console.info(
    `[media/generate] ${result.success ? "OK" : "FAIL"} code=${
      result.success ? "OK" : result.code
    } provider=${result.providerId} requestId=${result.requestId} status=${status}`,
  );
  return NextResponse.json(result, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": result.requestId,
    },
  });
}

// Rate limit: 60 requests/hour per user (generation is wallet-billed anyway)
export const POST = withRateLimit(handler, 60, 60);

export async function GET() {
  return NextResponse.json({
    providers: MEDIA_PROVIDERS,
    defaults: {
      image: "pollinations" as MediaProviderId,
      video: "huggingface" as MediaProviderId,
    },
  });
}
