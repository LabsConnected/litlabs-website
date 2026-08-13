import { NextRequest, NextResponse } from "next/server";
import { signToken } from "@/lib/jwt";
import { isAnonymousDevAllowed } from "@/lib/env";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" && !isAnonymousDevAllowed()) {
    return NextResponse.json({ error: "Dev login unavailable in production" }, { status: 403 });
  }

  const redirectUrl = req.nextUrl.searchParams.get("redirect") || "/studio";
  const email = req.nextUrl.searchParams.get("email") || "admin@litlabs.net";
  const name = req.nextUrl.searchParams.get("name") || "Larry B";

  const token = await signToken({
    id: "admin-dev-user",
    email,
    name,
  });

  const redirectTarget = new URL(redirectUrl, req.url);
  const response = NextResponse.redirect(redirectTarget);

  response.cookies.set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return response;
}
