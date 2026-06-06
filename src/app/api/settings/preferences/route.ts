import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getUserPreferences, updateUserPreferences } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * GET /api/settings/preferences
 * Returns the user's preferences from the database.
 */
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const preferences = await getUserPreferences(clerkId);
    
    // Return defaults if no preferences found
    return NextResponse.json({
      preferences: preferences || {
        theme_mode: "dark",
        theme_skin: "cyberpunk",
        theme_accent: "neon-green",
        crt_enabled: false,
      },
    });
  } catch (error) {
    console.error("Error fetching preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/preferences
 * Updates user preferences in the database.
 */
async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Map client preferences to database fields
    const updates: Record<string, string | boolean> = {};
    
    if (typeof body.theme === "string") {
      updates.theme_mode = body.theme;
    }
    if (typeof body.skin === "string") {
      updates.theme_skin = body.skin;
    }
    if (typeof body.accentColor === "string") {
      updates.theme_accent = body.accentColor;
    }
    if (typeof body.crtEnabled === "boolean") {
      updates.crt_enabled = body.crtEnabled;
    }
    // Support direct DB field names too
    if (typeof body.theme_mode === "string") updates.theme_mode = body.theme_mode;
    if (typeof body.theme_skin === "string") updates.theme_skin = body.theme_skin;
    if (typeof body.theme_accent === "string") updates.theme_accent = body.theme_accent;
    if (typeof body.crt_enabled === "boolean") updates.crt_enabled = body.crt_enabled;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const updated = await updateUserPreferences(clerkId, updates);

    return NextResponse.json({
      message: "Preferences updated successfully",
      preferences: updated,
    });
  } catch (error) {
    console.error("Error updating preferences:", error);
    return NextResponse.json(
      { error: "Failed to update preferences" },
      { status: 500 }
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 50, 60);
