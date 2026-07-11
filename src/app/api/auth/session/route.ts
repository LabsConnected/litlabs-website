import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("auth-token")?.value;
    if (!token) return NextResponse.json({ user: null });

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ user: null });

    return NextResponse.json({
      user: {
        id: payload.id as string,
        email: payload.email as string,
        name: (payload.name as string) || null,
      },
    });
  } catch (error) {
    console.error("Session error:", error);
    return NextResponse.json({ user: null });
  }
}
