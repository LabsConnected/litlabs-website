import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Skybox generation coming soon" }, { status: 503 });
}

export const dynamic = "force-dynamic";
