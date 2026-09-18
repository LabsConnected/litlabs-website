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
      return 503;
    case "QUOTA_EXCEEDED":
    case "PROVIDER_ERROR":
      return 502;
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
