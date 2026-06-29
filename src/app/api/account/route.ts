import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";
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

    // This creates the user + wallet + preferences if they don't exist
    const result = await getOrCreateUser(clerkId, "", "");

    return NextResponse.json({
      synced: true,
      isNew: result.isNew,
    });
  } catch {
    // [Account Sync] Error:
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
    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();

    if (findError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Delete all user data (cascade deletes will handle related tables)
    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", user.id);

    if (deleteError) {
      // Error deleting user:
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    // Note: Clerk user deletion should be done via Clerk Dashboard
    // or use Clerk's API to delete the user completely
    // This endpoint deletes local Supabase data only

    return NextResponse.json({
      message: "Account data deleted successfully",
      note: "Your Clerk authentication account must be deleted separately via Clerk Dashboard",
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
