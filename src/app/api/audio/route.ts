import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

const SYNTHWAVE_TRACKS = [
  { id: "1", title: "Midnight City", artist: "M83", duration: "4:03", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
  { id: "2", title: "Nightcall", artist: "Kavinsky", duration: "4:18", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
  { id: "3", title: "Tech Noir", artist: "Gunship", duration: "5:22", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
  { id: "4", title: "Retro Future", artist: "The Midnight", duration: "3:45", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
  { id: "5", title: "Neon Dreams", artist: "Timecop1983", duration: "4:31", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
  { id: "6", title: "Electric Youth", artist: "College", duration: "4:12", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
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
    return NextResponse.json({ error: "Failed to fetch audio" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);