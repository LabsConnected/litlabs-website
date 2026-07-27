import { NextRequest, NextResponse } from "next/server";
import { withRateLimit } from "@/lib/rate-limiter";

// Demo synthwave tracks. External SoundHelix URLs removed — they were
// blocked by CSP media-src and are just placeholder data. The dashboard
// music player will show "no preview available" until real tracks are
// self-hosted under /public/audio/.
const SYNTHWAVE_TRACKS = [
  { id: "1", title: "Midnight City",   artist: "M83",         duration: "4:03", url: "" },
  { id: "2", title: "Nightcall",       artist: "Kavinsky",    duration: "4:18", url: "" },
  { id: "3", title: "Tech Noir",       artist: "Gunship",     duration: "5:22", url: "" },
  { id: "4", title: "Retro Future",    artist: "The Midnight", duration: "3:45", url: "" },
  { id: "5", title: "Neon Dreams",     artist: "Timecop1983", duration: "4:31", url: "" },
  { id: "6", title: "Electric Youth",  artist: "College",     duration: "4:12", url: "" },
];

async function getHandler(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "playlist";

    if (action === "playlist") {
      return NextResponse.json({ tracks: SYNTHWAVE_TRACKS });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch audio" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
