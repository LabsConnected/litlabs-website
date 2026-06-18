import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/db";
import { signToken } from "@/lib/jwt";

export async function POST(req: NextRequest) {
  let email = "";
  let password = "";
  let isJson = false;

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    isJson = true;
    const body = await req.json();
    email = body.email || "";
    password = body.password || "";
  } else {
    const formData = await req.formData();
    email = (formData.get("email") as string) || "";
    password = (formData.get("password") as string) || "";
  }

  if (!email || !password) {
    if (isJson) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }
    return NextResponse.redirect(
      new URL("/login?error=Email+and+password+required", req.url)
    );
  }

  const user = await verifyPassword(email, password);
  if (!user) {
    if (isJson) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }
    return NextResponse.redirect(
      new URL("/login?error=Invalid+credentials", req.url)
    );
  }

  const token = await signToken({
    id: user.id,
    email: user.email,
    name: user.name,
  });

  // For JSON requests, return JSON with cookie
  const res = isJson
    ? NextResponse.json({
        user: { id: user.id, email: user.email, name: user.name || null },
      })
    : NextResponse.redirect(new URL("/dashboard", req.url));

  res.cookies.set("auth-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return res;
}
