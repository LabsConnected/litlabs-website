import { NextResponse } from "next/server";
import { getDeviceMap } from "@/lib/ha-api";

export async function GET() {
  try {
    const devices = await getDeviceMap();
    return NextResponse.json({ devices });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
