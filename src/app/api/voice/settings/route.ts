import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getDefaultProfile } from "@/features/voice/types";
import type { VoiceAgentId, AgentVoiceProfile } from "@/features/voice/types";

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("agent_voice_profiles")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return profiles for both agents, falling back to defaults
  const profiles: Record<string, AgentVoiceProfile> = {};
  for (const agentId of ["litt", "spark"] as VoiceAgentId[]) {
    const dbRow = data?.find((r) => r.agent_id === agentId);
    if (dbRow) {
      profiles[agentId] = {
        agentId,
        provider: "elevenlabs",
        providerVoiceId: dbRow.provider_voice_id || "",
        speed: dbRow.speed,
        stability: dbRow.stability,
        similarity: dbRow.similarity,
        style: dbRow.style,
        speakerBoost: dbRow.speaker_boost,
        autoSpeak: dbRow.auto_speak,
        allowInterruptions: dbRow.allow_interruptions,
        maxSpokenParagraphs: dbRow.max_spoken_paragraphs,
        muteCodeAndLogs: dbRow.mute_code_and_logs,
      };
    } else {
      profiles[agentId] = getDefaultProfile(agentId);
    }
  }

  return NextResponse.json({ profiles });
}

export async function PUT(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { agentId, settings } = body as {
    agentId?: VoiceAgentId;
    settings?: Partial<AgentVoiceProfile>;
  };

  if (!agentId || (agentId !== "litt" && agentId !== "spark")) {
    return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
  }

  if (!settings) {
    return NextResponse.json({ error: "No settings provided" }, { status: 400 });
  }

  const defaults = getDefaultProfile(agentId);
  const merged = { ...defaults, ...settings };

  const { error } = await supabaseAdmin
    .from("agent_voice_profiles")
    .upsert({
      user_id: userId,
      agent_id: agentId,
      provider: "elevenlabs",
      provider_voice_id: merged.providerVoiceId,
      speed: merged.speed,
      stability: merged.stability,
      similarity: merged.similarity,
      style: merged.style,
      speaker_boost: merged.speakerBoost,
      auto_speak: merged.autoSpeak,
      allow_interruptions: merged.allowInterruptions,
      max_spoken_paragraphs: merged.maxSpokenParagraphs,
      mute_code_and_logs: merged.muteCodeAndLogs,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,agent_id",
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agentId = request.nextUrl.searchParams.get("agentId") as VoiceAgentId | null;
  if (!agentId) {
    // Reset all
    const { error } = await supabaseAdmin
      .from("agent_voice_profiles")
      .delete()
      .eq("user_id", userId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabaseAdmin
      .from("agent_voice_profiles")
      .delete()
      .eq("user_id", userId)
      .eq("agent_id", agentId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
