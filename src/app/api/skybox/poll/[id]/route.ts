import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Feature not available" }, { status: 404 });
}

export const dynamic = "force-dynamic";
