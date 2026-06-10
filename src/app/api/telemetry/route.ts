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
    console.log("[Telemetry Event Received]:", JSON.stringify(body));

    return NextResponse.json({
      status: "success",
      message: "Telemetry event received and processed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Telemetry capture error:", error);
    return NextResponse.json(
      { error: "Failed to process telemetry" },
      { status: 500 }
    );
  }
}
