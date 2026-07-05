import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Skybox coming soon" }, { status: 503 });
}

export const dynamic = "force-dynamic";
