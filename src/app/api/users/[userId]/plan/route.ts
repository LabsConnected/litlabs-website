import { NextRequest, NextResponse } from "next/server";

const users: Map<string, { plan: string }> = new Map();

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const body = await req.json();
  const plan = body.plan || "free";

  users.set(userId, { plan });

  return NextResponse.json({ ok: true, plan });
}