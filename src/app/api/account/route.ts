import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getOrCreateUser } from "@/lib/user-db";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * GET /api/account
 * Ensures the user exists in our database. Called on every page load via UserSync.
 */
async function getHandler() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch real user info from Clerk so we don't insert blank email/name
    let email = `${clerkId}@placeholder.local`;
    let name = "";
    try {
      const clerk = await clerkClient();
      const clerkUser = await clerk.users.getUser(clerkId);
      email = clerkUser.emailAddresses[0]?.emailAddress ?? email;
      name =
        [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
        email.split("@")[0];
    } catch {
      // Clerk API unavailable — proceed with placeholder so sync still runs
    }

    const result = await getOrCreateUser(clerkId, email, name);

    return NextResponse.json({
      synced: true,
      isNew: result.isNew,
    });
  } catch {
    return NextResponse.json({ synced: false }, { status: 500 });
  }
}

/**
 * DELETE /api/account
 * Deletes the current user's account and all associated data from Supabase.
 * Requires Clerk authentication.
 */
async function deleteHandler() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find user in our database
    const { data: user, error: findError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();

    if (findError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Delete all user data (cascade deletes will handle related tables)
    const { error: deleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", user.id);

    if (deleteError) {
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    // Also delete the Clerk user so they can no longer sign in
    try {
      const clerk = await clerkClient();
      await clerk.users.deleteUser(clerkId);
    } catch {
      // Clerk deletion failed — Supabase data is already gone.
      // The user may still exist in Clerk but their LiTT data is wiped.
    }

    return NextResponse.json({
      message: "Account deleted successfully",
    });
  } catch {
    // Error deleting account:
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const DELETE = withRateLimit(deleteHandler, 10, 60);
