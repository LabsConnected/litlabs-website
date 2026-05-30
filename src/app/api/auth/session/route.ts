import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("auth-token")?.value;

  if (!token) {
    return NextResponse.json({
      user: null,
      debug: {
        hasToken: false,
        cookies: Object.fromEntries(req.cookies.getAll().map(c => [c.name, c.value.substring(0, 20) + '...'])),
        nodeEnv: process.env.NODE_ENV,
        hasAdminEmail: !!process.env.ADMIN_EMAIL,
        hasAdminHash: !!process.env.ADMIN_PASSWORD_HASH,
        hashPrefix: process.env.ADMIN_PASSWORD_HASH?.substring(0, 10) + '...',
      }
    });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({
      user: null,
      debug: {
        hasToken: true,
        tokenPrefix: token.substring(0, 20) + '...',
        verifyResult: 'invalid token',
      }
    });
  }

  return NextResponse.json({
    user: {
      id: payload.id,
      email: payload.email,
      name: payload.name,
    },
    debug: {
      hasToken: true,
      verifyResult: 'valid',
    }
  });
}
