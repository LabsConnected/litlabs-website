import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { checkUsageLimit } from "@/lib/usage";
import { isAdmin } from "@/lib/roles";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin();
  if (admin) {
    return NextResponse.json({ allowed: true, used: 0, limit: Infinity, role: "admin" });
  }

  const usage = await checkUsageLimit(userId);
  return NextResponse.json({ ...usage, role: "user" });
}
