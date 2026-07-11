import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.VOICE_MONKEY_TOKEN;
  const device = process.env.VOICE_MONKEY_DEVICE;

  if (!token || !device) {
    return NextResponse.json(
      { error: "Voice Monkey not configured. Set VOICE_MONKEY_TOKEN and VOICE_MONKEY_DEVICE env vars." },
      { status: 503 },
    );
  }

  let body: { notification?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const notification = body.notification || "Notification from LiTT Code";

  try {
    const url = new URL("https://api.voicemonkey.io/trigger");
    url.searchParams.set("token", token);
    url.searchParams.set("device", device);
    url.searchParams.set("notification", notification);

    const res = await fetch(url.toString(), { method: "GET" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(
        { error: data.message || "Voice Monkey API error", details: data },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: data.message || "Alexa routine triggered",
      details: data,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Network error" },
      { status: 502 },
    );
  }
}
