import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  let outboundIp = "(unknown)";
  try {
    const res = await fetch("https://api.ipify.org");
    outboundIp = await res.text();
  } catch (e) {
    outboundIp = "error: " + (e as Error).message;
  }

  return NextResponse.json({
    outboundIp,
    CLERK_FAPI_URL: process.env.CLERK_FAPI_URL || "(not set)",
    NEXT_PUBLIC_CLERK_PROXY_URL: process.env.NEXT_PUBLIC_CLERK_PROXY_URL || "(not set)",
    NODE_ENV: process.env.NODE_ENV,
  });
}
