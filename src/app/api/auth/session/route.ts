import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { withRateLimit } from "@/lib/rate-limiter";
import { isAnonymousDevAllowed } from "@/lib/env";

async function handler(req: NextRequest) {
  try {
    const token = req.cookies.get("auth-token")?.value;
    if (!token) {
      if (isAnonymousDevAllowed()) {
        return NextResponse.json({
          user: {
            id: "anonymous-dev",
            email: "dev@litlabs.local",
            name: "Dev User",
          },
        });
      }
      return NextResponse.json({ user: null });
    }

    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ user: null });

    return NextResponse.json({
      user: {
        id: payload.id as string,
        email: payload.email as string,
        name: (payload.name as string) || null,
      },
    });
  } catch (_error) {
    if (isAnonymousDevAllowed()) {
      return NextResponse.json({
        user: {
          id: "anonymous-dev",
          email: "dev@litlabs.local",
          name: "Dev User",
        },
      });
    }
    return NextResponse.json({ user: null });
  }
}

export const GET = withRateLimit(handler, 60, 60);
