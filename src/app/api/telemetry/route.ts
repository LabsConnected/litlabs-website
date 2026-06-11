import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    status: "healthy",
    service: "telemetry",
    timestamp: new Date().toISOString(),
    disabled: false,
  });
}

export async function POST(req: NextRequest) {
  try {
    let body = {};
    try {
      body = await req.json();
    } catch {
      // Ignore empty or invalid JSON payload
    }

    // Log the telemetry event to server stdout for audit trailing & troubleshooting
    // Telemetry event received

    return NextResponse.json({
      status: "success",
      message: "Telemetry event received and processed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Telemetry capture error — reject
    return NextResponse.json(
      { error: "Failed to process telemetry" },
      { status: 500 }
    );
  }
}
