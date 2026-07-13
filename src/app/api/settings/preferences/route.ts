import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { getUserByClerkId, getUserPreferences, upsertUserPreferences } from "@/lib/user-db";

async function getHandler() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let prefs = await getUserPreferences(clerkId);
    if (!prefs) {
      const user = await getUserByClerkId(clerkId);
      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }
      prefs = await upsertUserPreferences(user.id, {});
    }

    return NextResponse.json({ preferences: prefs ?? {} });
  } catch {
    return NextResponse.json(
      { error: "Failed to load preferences" },
      { status: 500 }
    );
  }
}

async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const user = await getUserByClerkId(clerkId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    const allowedKeys = new Set([
      "notify_discord",
      "notify_alexa",
      "notify_email",
      "workspace_autosave",
      "workspace_compact",
      "workspace_live_preview",
      "workspace_telemetry",
      "workspace_default",
    ]);

    for (const [key, value] of Object.entries(body)) {
      if (allowedKeys.has(key)) {
        updates[key] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid preference fields" },
        { status: 400 }
      );
    }

    const prefs = await upsertUserPreferences(user.id, updates);
    return NextResponse.json({ preferences: prefs });
  } catch {
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 60, 60);
