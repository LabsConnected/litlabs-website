import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { MEDIA_PROVIDERS } from "@/lib/media";
import {
  generateMediaForUser,
  type MediaRequest,
  type GenerationErrorResponse,
} from "@/lib/media/image-generation-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve the trusted server-to-server identity used by the approved agent tool. */
export function resolveAgentServiceUser(req: NextRequest): string | null {
  const expectedKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
  if (!expectedKey) return null;
  const providedKey = req.headers.get("X-Internal-Service-Key");
  const agentUserId = req.headers.get("X-Agent-User-Id");
  if (!providedKey || !agentUserId) return null;
  const a = Buffer.from(providedKey);
  const b = Buffer.from(expectedKey);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return agentUserId;
}

async function handler(req: NextRequest) {
  const agentUserId = resolveAgentServiceUser(req);
  const { userId } = agentUserId ? { userId: agentUserId } : await auth(req);
  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        requestId: "",
        providerId: null,
        code: "UNAUTHORIZED",
        error: "Sign in to generate media",
        retryable: false,
      } satisfies GenerationErrorResponse,
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: MediaRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        requestId: "parse-error",
        providerId: null,
        code: "BAD_REQUEST",
        error: "Invalid request body — send JSON",
        retryable: false,
      } satisfies GenerationErrorResponse,
      { status: 400, headers: { "Cache-Control": "no-store", "X-Request-Id": "parse-error" } },
    );
  }

  return generateMediaForUser(userId, body);
}

export const POST = withRateLimit(handler, 60, 60);

export async function GET() {
  return NextResponse.json({
    providers: MEDIA_PROVIDERS,
    defaults: { image: "pollinations", video: "huggingface" },
  });
}
