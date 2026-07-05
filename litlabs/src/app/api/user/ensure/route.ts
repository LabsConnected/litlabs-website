import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { getOrCreateUser, getUserWallet } from "@/lib/user-db";

export const dynamic = "force-dynamic";

export async function POST() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Fetch real Clerk user data
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
      // Clerk API unavailable — proceed with placeholder
    }

    // getOrCreateUser uses admin client server-side (bypasses RLS)
    // and inserts wallet with 500 coins on first create
    const { user, isNew } = await getOrCreateUser(clerkId, email, name);

    if (!user) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    // Also ensure wallet exists (idempotent — getUserWallet auto-creates if missing)
    const wallet = await getUserWallet(clerkId);

    return NextResponse.json({
      success: true,
      isNew,
      user: { id: user.id, email: user.email, name: user.name },
      balance: wallet.balance,
    });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json(
      { exists: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const wallet = await getUserWallet(clerkId);
    const exists = wallet.id !== "fallback";
    return NextResponse.json({ exists, balance: wallet.balance });
  } catch {
    return NextResponse.json({ exists: false, balance: 0 });
  }
}
