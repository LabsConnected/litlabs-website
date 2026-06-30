import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const users: Map<string, { plan: string }> = new Map();

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  // Only the user themselves or an admin can change plans
  const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS || "").split(",").filter(Boolean);
  if (clerkId !== userId && !ADMIN_CLERK_IDS.includes(clerkId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const plan = body.plan || "free";

  users.set(userId, { plan });

  return NextResponse.json({ ok: true, plan });
}