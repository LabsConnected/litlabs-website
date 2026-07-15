import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getDeviceMap } from "@/lib/ha-api";
import { sanitizeProviderError } from "@/lib/provider-error";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const devices = await getDeviceMap();
    return NextResponse.json({ devices });
  } catch (err) {
    console.error("[api/ha/devices] error:", err);
    const { status, error: msg } = sanitizeProviderError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
