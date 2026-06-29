import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabase } from "@/lib/supabase";

export async function POST() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sb = getSupabase();
  if (!sb) {
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 },
    );
  }

  try {
    // Check if user exists
    const { data: existing } = await sb
      .from("users")
      .select("id, clerk_id, username")
      .eq("clerk_id", clerkId)
      .single();

    if (existing) {
      return NextResponse.json({
        success: true,
        user: existing,
        message: "User already exists",
      });
    }

    // Get user info from Clerk (we'll need to create a basic record)
    // Generate a username from clerkId
    const shortId = clerkId.slice(-8);
    const username = `user_${shortId}`;
    const displayName = `LiTBit User ${shortId}`;

    // Create user in Supabase
    const { data: newUser, error } = await sb
      .from("users")
      .insert({
        clerk_id: clerkId,
        username: username,
        display_name: displayName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create user" },
        { status: 500 },
      );
    }

    // Create initial wallet
    await sb.from("wallets").insert({
      user_id: newUser.id,
      balance: 500, // Starting bonus
      lifetime_earned: 500,
    });

    return NextResponse.json({
      success: true,
      user: newUser,
      message: "User created successfully",
      startingBalance: 500,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Also allow GET for simple check
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json(
      { exists: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  const sb = getSupabase();
  if (!sb) {
    return NextResponse.json(
      { exists: false, error: "Database unavailable" },
      { status: 503 },
    );
  }

  const { data: user } = await sb
    .from("users")
    .select("id, username, display_name")
    .eq("clerk_id", clerkId)
    .single();

  return NextResponse.json({
    exists: !!user,
    user: user || null,
  });
}
