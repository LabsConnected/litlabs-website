import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * DELETE /api/account
 * Deletes the current user's account and all associated data from Supabase.
 * Requires Clerk authentication.
 */
async function deleteHandler(req: NextRequest) {
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
      console.error("Error deleting user:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 }
      );
    }

    // Note: Clerk user deletion should be done via Clerk Dashboard
    // or use Clerk's API to delete the user completely
    // This endpoint deletes local Supabase data only

    return NextResponse.json({
      message: "Account data deleted successfully",
      note: "Your Clerk authentication account must be deleted separately via Clerk Dashboard",
    });
  } catch (error) {
    console.error("Error deleting account:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }
}

export const DELETE = withRateLimit(deleteHandler, 10, 60);
