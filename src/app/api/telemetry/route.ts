import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    service: "telemetry",
    timestamp: new Date().toISOString(),
    disabled: false,
  });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    try {
      await req.json();
    } catch {
      // Ignore empty or invalid JSON payload
    }

    return NextResponse.json({
      status: "success",
      message: "Telemetry event received and processed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to process telemetry" },
      { status: 500 },
    );
  }
}
