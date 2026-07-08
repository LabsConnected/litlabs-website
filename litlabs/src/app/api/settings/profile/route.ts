import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getUserByClerkId,
  updateUserProfile,
  getOrCreateUser,
} from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * GET /api/settings/profile
 * Returns the current user's profile from the database.
 */
async function getHandler() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let user = await getUserByClerkId(clerkId);

    // Auto-create user if not exists (first time sign in)
    if (!user) {
      // Get user info from Clerk
      const clerkRes = await fetch(
        `https://api.clerk.dev/v1/users/${clerkId}`,
        {
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        },
      );

      if (!clerkRes.ok) {
        return NextResponse.json(
          { error: "Failed to fetch user from Clerk" },
          { status: 500 },
        );
      }

      const clerkUser = await clerkRes.json();
      const email = clerkUser.email_addresses?.[0]?.email_address || "";
      const name =
        clerkUser.first_name && clerkUser.last_name
          ? `${clerkUser.first_name} ${clerkUser.last_name}`
          : clerkUser.first_name || email.split("@")[0];

      const result = await getOrCreateUser(clerkId, email, name);
      user = result.user;
      if (!user) {
        return NextResponse.json(
          { error: "Failed to create user", detail: result.error },
          { status: 500 },
        );
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        clerk_id: user.clerk_id,
        email: user.email,
        name: user.name,
        username: user.username,
        avatar_url: user.avatar_url,
        cover_url: (user as { cover_url?: string | null }).cover_url ?? null,
        bio: user.bio,
        website: user.website,
        location: user.location,
        mood: (user as { mood?: string | null }).mood ?? null,
        interests: (user as { interests?: string[] | null }).interests ?? null,
        social_links: (user as { social_links?: Record<string, string> | null }).social_links ?? null,
        music_links: (user as { music_links?: Record<string, string> | null }).music_links ?? null,
        created_at: user.created_at,
      },
    });
  } catch {
    // Error fetching profile:
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/settings/profile
 * Updates the user's profile in the database.
 * Auto-creates the user record if it doesn't exist yet.
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

    // Only allow updating certain fields
    const allowedUpdates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      allowedUpdates.name = body.name.trim();
    }
    if (typeof body.username === "string" && body.username.trim()) {
      allowedUpdates.username = body.username.trim();
    }
    if (typeof body.bio === "string") allowedUpdates.bio = body.bio;
    if (typeof body.website === "string") allowedUpdates.website = body.website;
    if (typeof body.location === "string") allowedUpdates.location = body.location;
    if (typeof body.avatar_url === "string") allowedUpdates.avatar_url = body.avatar_url;
    if (typeof body.cover_url === "string") allowedUpdates.cover_url = body.cover_url;
    if (typeof body.mood === "string") allowedUpdates.mood = body.mood;
    if (Array.isArray(body.interests)) allowedUpdates.interests = body.interests;
    if (body.social_links && typeof body.social_links === "object") {
      allowedUpdates.social_links = body.social_links;
    }
    if (body.music_links && typeof body.music_links === "object") {
      allowedUpdates.music_links = body.music_links;
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    // Ensure the user exists before updating. If not, fetch from Clerk and create.
    let user = await getUserByClerkId(clerkId);
    if (!user) {
      const clerkRes = await fetch(
        `https://api.clerk.dev/v1/users/${clerkId}`,
        {
          headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        },
      );
      if (!clerkRes.ok) {
        return NextResponse.json(
          { error: "Failed to fetch user from Clerk" },
          { status: 500 },
        );
      }
      const clerkUser = await clerkRes.json();
      const email = clerkUser.email_addresses?.[0]?.email_address || "";
      const name =
        clerkUser.first_name && clerkUser.last_name
          ? `${clerkUser.first_name} ${clerkUser.last_name}`
          : clerkUser.first_name || email.split("@")[0];
      const result = await getOrCreateUser(clerkId, email, name);
      user = result.user;
      if (!user) {
        return NextResponse.json(
          { error: "Failed to create user", detail: result.error },
          { status: 500 },
        );
      }
    }

    const updatedUser = await updateUserProfile(clerkId, allowedUpdates);

    return NextResponse.json({
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        clerk_id: updatedUser.clerk_id,
        email: updatedUser.email,
        name: updatedUser.name,
        username: updatedUser.username,
        avatar_url: updatedUser.avatar_url,
        cover_url: (updatedUser as { cover_url?: string | null }).cover_url ?? null,
        bio: updatedUser.bio,
        website: updatedUser.website,
        location: updatedUser.location,
        mood: (updatedUser as { mood?: string | null }).mood ?? null,
        interests: (updatedUser as { interests?: string[] | null }).interests ?? null,
        social_links: (updatedUser as { social_links?: Record<string, string> | null }).social_links ?? null,
        music_links: (updatedUser as { music_links?: Record<string, string> | null }).music_links ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to update profile", detail: message },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 50, 60);
