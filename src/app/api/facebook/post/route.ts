import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAdmin } from "@/lib/roles";
import { withRateLimit } from "@/lib/rate-limiter";

export const dynamic = "force-dynamic";

const GRAPH_API_VERSION = "v25.0";

async function handler(req: NextRequest) {
  // Lock this to admin users because it can publish to a public Facebook Page.
  // If you want any signed-in user to post, replace isAdmin() with a simple auth() check.
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required to publish to Facebook." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";

  if (!message) {
    return NextResponse.json(
      { error: "Post message is required." },
      { status: 400 },
    );
  }

  const pageId = process.env.FACEBOOK_PAGE_ID;
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

  if (!pageId || !accessToken) {
    return NextResponse.json(
      { error: "Facebook Page credentials are not configured server-side." },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${pageId}/feed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          access_token: accessToken,
        }),
      },
    );

    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const fbError =
        typeof data.error === "object" && data.error !== null
          ? (data.error as { message?: string; code?: number; type?: string })
          : undefined;

      return NextResponse.json(
        {
          error: fbError?.message || "Facebook Graph API request failed.",
          code: fbError?.code ?? null,
          type: fbError?.type ?? null,
          details: data,
        },
        { status: response.status },
      );
    }

    const postId = typeof data.id === "string" ? data.id : null;

    return NextResponse.json({
      success: true,
      postId,
      permalink:
        postId ? `https://www.facebook.com/${postId.replace("_", "/posts/")}` : null,
      raw: data,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unexpected server error.";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 10, 60);
