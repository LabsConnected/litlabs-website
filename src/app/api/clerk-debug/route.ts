import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    CLERK_FAPI_URL: process.env.CLERK_FAPI_URL || "(not set)",
    CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.slice(0, 20) + "..." || "(not set)",
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ? "(set)" : "(not set)",
    NEXT_PUBLIC_CLERK_PROXY_URL: process.env.NEXT_PUBLIC_CLERK_PROXY_URL || "(not set)",
    NODE_ENV: process.env.NODE_ENV,
  });
}
