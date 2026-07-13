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
      const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
      const dbConfigured = !!dbUrl && !dbUrl.includes("your-project");

      if (dbConfigured && process.env.CLERK_SECRET_KEY) {
        const clerkRes = await fetch(
          `https://api.clerk.dev/v1/users/${clerkId}`,
          {
            headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
          },
        );

        if (clerkRes.ok) {
          const clerkUser = await clerkRes.json();
          const email = clerkUser.email_addresses?.[0]?.email_address || "";
          const name =
            clerkUser.first_name && clerkUser.last_name
              ? `${clerkUser.first_name} ${clerkUser.last_name}`
              : clerkUser.first_name || email.split("@")[0];
          const result = await getOrCreateUser(clerkId, email, name);
          user = result.user;
        }
      }

      // If DB is unavailable or Clerk lookup failed, return a synthetic profile
      // so the UI never gets a 500/503 just for loading the user header.
      if (!user) {
        return NextResponse.json({
          user: {
            id: clerkId,
            clerk_id: clerkId,
            email: "",
            name: "Creator",
            username: null,
            avatar_url: null,
            cover_url: null,
            bio: null,
            website: null,
            location: null,
            created_at: new Date().toISOString(),
          },
        });
      }
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
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error("[api/settings/profile] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/settings/profile
 * Updates the user's profile in the database.
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
    const allowedUpdates = {
      ...(typeof body.name === "string" &&
        body.name.trim() && { name: body.name.trim() }),
      ...(typeof body.username === "string" &&
        body.username.trim() && { username: body.username.trim() }),
      ...(typeof body.bio === "string" && { bio: body.bio }),
      ...(typeof body.website === "string" && { website: body.website }),
      ...(typeof body.location === "string" && { location: body.location }),
      ...(typeof body.avatar_url === "string" && {
        avatar_url: body.avatar_url,
      }),
      ...(typeof body.cover_url === "string" && {
        cover_url: body.cover_url,
      }),
    };

    if (Object.keys(allowedUpdates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
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
      },
    });
  } catch {
    // Error updating profile:
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 50, 60);
