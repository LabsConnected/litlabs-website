import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ── P0.1: UI lock fix ──────────────────────────────────────────────────────

describe("Music Lab P0.1 — UI lock fix", () => {
  it("GenerationStatus type includes 'idle'", () => {
    const content = read("src/types/music.ts");
    expect(content).toContain('"idle"');
  });

  it("useMusicGeneration hook initial status is 'idle' not 'queued'", () => {
    const content = read("src/hooks/use-music-generation.ts");
    // The initial state must set status to "idle"
    expect(content).toMatch(/status:\s*"idle"/);
    // Must NOT have the old initial state with "queued" as default
    const initialStateMatch = content.match(/useState<GenerationState>\(\{[\s\S]*?status:\s*"(\w+)"/);
    expect(initialStateMatch).toBeTruthy();
    expect(initialStateMatch![1]).toBe("idle");
  });

  it("PROGRESS_MAP includes idle: 0", () => {
    const content = read("src/hooks/use-music-generation.ts");
    expect(content).toMatch(/idle:\s*0/);
  });

  it("MusicTool isBusy does not include 'idle' in active states", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    // isBusy should check for active states but idle is not among them
    const isBusyLine = content.match(/const isBusy.*?includes\(status\)/);
    expect(isBusyLine).toBeTruthy();
    expect(isBusyLine![0]).not.toContain("idle");
  });

  it("Controls are not disabled on fresh page load (isBusy is false initially)", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    // The isBusy check must not include "idle"
    expect(content).toContain('["queued", "preparing", "generating", "processing"]');
    // Generate button disabled condition uses isBusy
    expect(content).toMatch(/disabled=\{isBusy/);
  });
});

// ── P0.2: Serverless background job fix ────────────────────────────────────

describe("Music Lab P0.2 — Durable job recovery", () => {
  it("processGeneration is exported (not private)", () => {
    const content = read("src/lib/music/generation-service.ts");
    expect(content).toMatch(/export\s+async\s+function\s+processGeneration/);
  });

  it("claimStaleGenerations function exists", () => {
    const content = read("src/lib/music/generation-service.ts");
    expect(content).toContain("claimStaleGenerations");
    expect(content).toContain("STALE_THRESHOLD_MINUTES");
  });

  it("resumeGeneration function exists", () => {
    const content = read("src/lib/music/generation-service.ts");
    expect(content).toContain("resumeGeneration");
  });

  it("processPendingGenerations function exists", () => {
    const content = read("src/lib/music/generation-service.ts");
    expect(content).toContain("processPendingGenerations");
  });

  it("Worker API route exists", () => {
    const content = read("src/app/api/music/worker/route.ts");
    expect(content).toContain("processPendingGenerations");
    expect(content).toContain("MUSIC_WORKER_SECRET");
  });

  it("Client hook triggers worker on stale queued job", () => {
    const content = read("src/hooks/use-music-generation.ts");
    expect(content).toContain("queuedSinceRef");
    expect(content).toContain("workerTriggeredRef");
    expect(content).toContain("/api/music/worker");
    expect(content).toContain("30_000");
  });
});

// ── P0.3: Provider audit ───────────────────────────────────────────────────

describe("Music Lab P0.3 — ElevenLabs provider audit", () => {
  it("Uses correct model_id 'music_v2' (not 'music-v2')", () => {
    const content = read("src/lib/music/providers/elevenlabs.ts");
    // Must use music_v2 in the actual request body
    expect(content).toMatch(/model_id:\s*"music_v2"/);
    // Must NOT use music-v2 in the request body (comments mentioning it are OK)
    const codeOnly = content.replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/model_id:\s*"music-v2"/);
  });

  it("Uses correct endpoint /v1/music (not /v1/music/compose)", () => {
    const content = read("src/lib/music/providers/elevenlabs.ts");
    // Must POST to /v1/music endpoint
    expect(content).toMatch(/`\$\{this\.baseUrl\}\/music`/);
    // Must NOT use /music/compose in actual code (comments are OK)
    const codeOnly = content.replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("/music/compose");
  });

  it("Uses music_length_ms in milliseconds (not duration in seconds)", () => {
    const content = read("src/lib/music/providers/elevenlabs.ts");
    expect(content).toContain("music_length_ms");
    expect(content).not.toMatch(/duration:\s*Math\.min/);
  });

  it("Reads audio bytes directly from streaming response", () => {
    const content = read("src/lib/music/providers/elevenlabs.ts");
    expect(content).toContain("arrayBuffer");
    expect(content).toContain("Buffer.from");
    expect(content).toContain("data:audio/mpeg;base64");
  });
});

// ── P0.4: Composition plan support ─────────────────────────────────────────

describe("Music Lab P0.4 — Composition plans", () => {
  it("CompositionPlan type exists in music types", () => {
    const content = read("src/types/music.ts");
    expect(content).toContain("CompositionPlan");
    expect(content).toContain("CompositionChunk");
    expect(content).toContain("positive_global_styles");
    expect(content).toContain("negative_global_styles");
    expect(content).toContain("context_adherence");
  });

  it("GenerateSongInput has compositionPlan field", () => {
    const content = read("src/types/music.ts");
    expect(content).toContain("compositionPlan?");
  });

  it("buildCompositionPlanFromBlueprint function exists", () => {
    const content = read("src/lib/music/providers/elevenlabs.ts");
    expect(content).toContain("buildCompositionPlanFromBlueprint");
    expect(content).toContain("parseLyricSections");
    expect(content).toContain("distributeDurations");
  });

  it("Generation service passes composition plans to provider", () => {
    const content = read("src/lib/music/generation-service.ts");
    expect(content).toContain("compositionPlan");
    expect(content).toContain("buildCompositionPlanFromBlueprint");
  });

  it("Composition plan is used for full-length songs with ElevenLabs", () => {
    const content = read("src/lib/music/generation-service.ts");
    expect(content).toContain('provider.name === "elevenlabs"');
    expect(content).toContain("input.durationSeconds > 30");
  });
});

// ── P0.5: Real status phases ───────────────────────────────────────────────

describe("Music Lab P0.5 — Real status phases", () => {
  it("Progress display uses phase labels not just status text", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    expect(content).toContain("Queued — waiting for producer");
    expect(content).toContain("Preparing — building blueprint");
    expect(content).toContain("Writing — composing your track");
    expect(content).toContain("Rendering — saving audio");
  });

  it("Indeterminate progress bar animation exists", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    expect(content).toContain("music-progress-indeterminate");
    const css = read("src/app/globals.css");
    expect(css).toContain("music-progress-indeterminate");
  });
});

// ── P0.6: Cancel/refund confirmation ───────────────────────────────────────

describe("Music Lab P0.6 — Cancel confirmation", () => {
  it("cancelGeneration waits for backend confirmation", () => {
    const content = read("src/hooks/use-music-generation.ts");
    // Must await the fetch call, not fire-and-forget
    expect(content).toContain("isCancelling");
    expect(content).toMatch(/[\s\S]*await\s+fetch[\s\S]*cancel/);
    expect(content).toContain("res.ok");
  });

  it("Cancel button shows loading state", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    expect(content).toContain("isCancelling");
    expect(content).toContain("Cancelling…");
  });

  it("Cancel reverts status if backend rejects", () => {
    const content = read("src/hooks/use-music-generation.ts");
    // On backend rejection, should re-poll to get actual status
    expect(content).toContain("pollStatus(genId)");
  });
});

// ── Phase 3+4: Real LiTT Producer + Prompt Enhancement ─────────────────────

describe("Music Lab Phase 3+4 — Real AI producer", () => {
  it("Producer API route exists", () => {
    const content = read("src/app/api/music/producer/route.ts");
    expect(content).toContain("generateJSON");
    expect(content).toContain("enhancedPrompt");
    expect(content).toContain("producerNote");
    expect(content).toContain("songStructure");
  });

  it("Prompt enhancement API route exists", () => {
    const content = read("src/app/api/music/enhance-prompt/route.ts");
    expect(content).toContain("generateJSON");
    expect(content).toContain("enhanced");
    expect(content).toContain("genre");
    expect(content).toContain("productionTexture");
  });

  it("MusicTool handleImprovePrompt calls API (not random suffix)", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    expect(content).toContain("/api/music/enhance-prompt");
    expect(content).toContain("isEnhancing");
    // Must NOT contain the old random enhancers
    expect(content).not.toContain("enhancers[Math.floor");
  });

  it("MusicTool handleProducerSend calls API (not canned keywords)", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    expect(content).toContain("/api/music/producer");
    expect(content).toContain("isProducerLoading");
    // Must NOT contain the old canned keyword matching
    expect(content).not.toContain(/\/(harder|aggressive|bang|808|trap)\//);
  });

  it("Producer transform buttons show loading state", () => {
    const content = read("src/app/studio/tools/MusicTool.tsx");
    expect(content).toContain("isProducerLoading");
  });
});
