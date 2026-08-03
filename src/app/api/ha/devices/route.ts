import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDeviceMap } from "@/lib/ha-api";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const devices = await getDeviceMap();
    return NextResponse.json({ devices });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
