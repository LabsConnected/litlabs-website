/**
 * Station Control Bridge — music station (chunk C, server-only).
 *
 * Backend wiring (verified against /api/media/generate-music/route.ts and
 * /api/music/generations/route.ts):
 * - Uses the clean provider substrate: src/lib/music/providers/* via
 *   getActiveProvider() (Lyria 3 on GEMINI_API_KEY, ElevenLabs Music on
 *   ELEVENLABS_API_KEY, Mureka async on MUREKA_API_KEY). The routes' wallet
 *   billing is NOT replicated (see video.ts rationale); the action is
 *   requiresApproval:true → advertise.ts STATION_MUTATION_APPROVAL.
 * - The MOCK provider is never used: if the active provider resolves to
 *   "mock", the action fails honestly (not_configured) instead of producing
 *   fake audio. This matches the routes' production guard.
 * - Lyria/ElevenLabs stream audio directly (no poll); Mureka is async and
 *   gets the bounded poll loop. Completed audio saves to the project as
 *   /assets/audio/x.mp3 (or .wav per the provider's mime) when a project
 *   transport is present.
 * - music.remix is DELIBERATELY NOT REGISTERED: no remix endpoint exists
 *   anywhere in the codebase (audit §3 confirmed).
 */
import "server-only";

import { z } from "zod";

import { registerStationAction } from "../registry";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import {
  fail,
  getTransport,
  ok,
  saveMediaToProject,
  sleep,
  stationResultSchema,
} from "./creator-helpers";
import {
  creatorKey,
  getCreatorParams,
  pushCreatorResult,
  setCreatorParams,
} from "./creator-state";
import { getActiveProvider } from "@/lib/music/providers/factory";
import type { MusicBlueprint } from "@/types/music";

const POLL_BUDGET_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 10_000;

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown (zod v4: bare z.ZodType infers
 * unknown — same pattern as chunk B's browser.ts). The executor safeParses
 * raw args against argsSchema before invoking execute, so the cast to the
 * erased StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

defineAction({
  id: "music.setStyle",
  station: "music",
  description: "Stage the musical style/genre for the next music.generate.",
  argsSchema: z.object({ style: z.string().min(1) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { musicStyle: args.style });
    return ok({ style: args.style });
  },
});

defineAction({
  id: "music.setLyrics",
  station: "music",
  description: "Stage lyrics for the next music.generate (empty string = instrumental).",
  argsSchema: z.object({ lyrics: z.string() }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { musicLyrics: args.lyrics });
    return ok({ lyrics: args.lyrics, instrumental: args.lyrics.trim().length === 0 });
  },
});

defineAction({
  id: "music.setBpm",
  station: "music",
  description: "Stage the tempo in BPM for the next music.generate.",
  argsSchema: z.object({ bpm: z.number().int().min(40).max(220) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    setCreatorParams(creatorKey(ctx), { musicBpm: args.bpm });
    return ok({ bpm: args.bpm });
  },
});

function buildBlueprint(ctx: StationExecutionContext): MusicBlueprint {
  const params = getCreatorParams(creatorKey(ctx));
  const lyrics = params.musicLyrics?.trim() || undefined;
  return {
    title: params.prompt?.slice(0, 60) || "Untitled",
    genre: params.musicStyle ? [params.musicStyle] : ["electronic"],
    mood: [],
    bpm: params.musicBpm,
    durationSeconds: 30,
    instrumental: !lyrics,
    lyrics,
    structure: [],
    production: [],
    avoid: [],
    instruments: [],
    explicit: false,
  };
}

defineAction({
  id: "music.generate",
  station: "music",
  description:
    "Generate music with the configured real provider (Lyria 3 / ElevenLabs / Mureka — whichever is keyed). Streaming providers return audio directly; async providers are polled up to 10 min. Completed audio saves to the project as /assets/audio/x.mp3.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (_args, ctx): Promise<StationResult> => {
    const key = creatorKey(ctx);
    const params = getCreatorParams(key);
    const prompt = params.prompt?.trim();
    if (!prompt || prompt.length < 3) {
      return fail(
        "No music prompt staged. Call music.setStyle (or image.setPrompt-equivalent staging) — set a prompt via music.setStyle/music.setLyrics first.",
        "invalid_args",
      );
    }

    const provider = getActiveProvider();
    if (provider.name === "mock") {
      return fail(
        "No music provider configured. Set GEMINI_API_KEY (Lyria 3), ELEVENLABS_API_KEY, or MUREKA_API_KEY.",
        "not_configured",
      );
    }

    const blueprint = buildBlueprint(ctx);
    ctx.emitEvent({
      type: "live_state",
      actionId: "music.generate",
      station: "music",
      summary: `Music generation started via ${provider.name}`,
    });

    let submitted;
    try {
      submitted = await provider.generateSong({
        prompt,
        instrumental: blueprint.instrumental,
        durationSeconds: blueprint.durationSeconds,
        lyrics: blueprint.lyrics,
        idempotencyKey: ctx.actionContext?.actionRunId ?? crypto.randomUUID(),
        blueprint,
      });
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : "Music generation failed",
        "execution_failed",
      );
    }
    if (submitted.status === "failed") {
      return fail(
        submitted.error ?? "Music generation failed",
        /not configured/i.test(submitted.error ?? "") ? "not_configured" : "execution_failed",
      );
    }

    // Async providers (Mureka): bounded poll.
    let audioUrl = submitted.audioUrl;
    if (!audioUrl && submitted.providerJobId && provider.supportsAsyncPolling) {
      const deadline = Date.now() + POLL_BUDGET_MS;
      for (;;) {
        if (ctx.signal?.aborted) return fail("Music generation aborted", "execution_failed");
        const polled = await provider.getStatus(submitted.providerJobId);
        if (polled.status === "completed" && polled.audioUrl) {
          audioUrl = polled.audioUrl;
          break;
        }
        if (polled.status === "failed" || polled.status === "cancelled") {
          return fail(`Music generation ${polled.status}: ${polled.error ?? "unknown error"}`, "execution_failed");
        }
        if (Date.now() >= deadline) {
          return ok({
            status: "processing",
            providerJobId: submitted.providerJobId,
            reason: "Poll budget (10 min) expired before completion — NOT a failure. Re-check later.",
          });
        }
        ctx.emitEvent({
          type: "live_state",
          actionId: "music.generate",
          station: "music",
          summary: `Music job ${submitted.providerJobId}: ${polled.status}…`,
        });
        try {
          await sleep(POLL_INTERVAL_MS, ctx.signal);
        } catch {
          return fail("Music generation aborted", "execution_failed");
        }
      }
    }

    if (!audioUrl) {
      return fail(
        "Music provider returned no audio and no pollable job id.",
        "execution_failed",
      );
    }

    const resultId = `mus_${Date.now()}`;
    pushCreatorResult(key, { id: resultId, url: audioUrl, kind: "music" });

    const mimeMatch = /^data:(audio\/[a-z0-9+-]+)/i.exec(audioUrl);
    const extension = mimeMatch && /mp3|mpeg/i.test(mimeMatch[1]) ? "mp3" : "wav";
    const transport = getTransport(ctx);
    if (transport && ctx.projectId) {
      const saved = await saveMediaToProject(
        audioUrl,
        { nameHint: "music", subdir: "audio", allowedMimes: ["audio/mp3", "audio/wav", "audio/mpeg"], extension },
        transport,
        ctx.signal,
      );
      if (!saved.success) {
        return ok({ status: "completed", audioUrl, resultId, savedToProject: false, saveError: saved.error, provider: provider.name });
      }
      return ok({
        status: "completed",
        audioUrl,
        resultId,
        savedToProject: true,
        assetPath: saved.path,
        sitePath: saved.sitePath,
        provider: provider.name,
      });
    }
    ctx.reportLiveState({ station: "music", action: "music.generate", status: "completed", provider: provider.name });
    return ok({
      status: "completed",
      audioUrl,
      resultId,
      savedToProject: false,
      reason: "No project transport in this context — audio is chat-only.",
      provider: provider.name,
    });
  },
});

// NOTE: music.remix is intentionally NOT registered — no remix endpoint
// exists anywhere in the codebase.
