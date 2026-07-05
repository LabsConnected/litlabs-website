import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "litlabs",
    timestamp: new Date().toISOString(),
    region: process.env.VERCEL_REGION || "local",
  });
}