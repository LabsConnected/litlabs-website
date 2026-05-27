import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const adminEmail = process.env.ADMIN_EMAIL || "";
  const adminHash = process.env.ADMIN_PASSWORD_HASH || "";

  // If admin not configured, become the first admin
  if (!adminEmail || !adminHash) {
    const hash = await bcrypt.hash(password, 12);
    return NextResponse.json({
      message: "Admin account configured",
      envVars: {
        ADMIN_EMAIL: email,
        ADMIN_PASSWORD_HASH: hash,
        ADMIN_NAME: name || "Admin",
      }
    });
  }

  return NextResponse.json({ error: "Registration is closed" }, { status: 403 });
}
