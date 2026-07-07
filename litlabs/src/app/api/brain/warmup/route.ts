import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { warmupBrain } from "@/lib/brain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const warmup = await warmupBrain(userId);
    return NextResponse.json({ ...warmup, userId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Warmup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
