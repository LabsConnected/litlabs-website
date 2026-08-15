import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("Audio Lab — Download fix", () => {
  it("AudioTool handleDownload supports data: URLs (converts to blob)", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    // Must not reject data: URLs with the old error message
    expect(content).not.toContain("can't be downloaded");
    // Must convert data URLs to blobs
    expect(content).toContain("dataUrlToBlob");
    expect(content).toContain("createObjectURL");
    expect(content).toContain("revokeObjectURL");
  });
});

describe("Audio Lab — No base64 in localStorage", () => {
  it("AudioTool does not persist audioUrl in localStorage", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    // Must strip audioUrl before persisting
    expect(content).toContain("audioUrl: undefined");
  });

  it("AudioTool MAX_HISTORY is reasonable (not 12 with base64)", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("MAX_HISTORY = 8");
  });
});

describe("Audio Lab — No misleading Music/Sound label", () => {
  it("AudioTool does not have Music / Sound mode", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).not.toContain("Music / Sound");
    expect(content).not.toContain('"music"');
  });

  it("AudioTool redirects to LiTT Music instead of duplicating", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("Open LiTT Music");
    expect(content).toContain("/studio?tool=music");
  });

  it("AudioTool is renamed to LiTT Audio Lab", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("LiTT Audio Lab");
  });
});

describe("Audio Lab — Billing migration", () => {
  it("generate-audio uses adjustWalletBalance (not updateWalletBalance)", () => {
    const content = read("src/app/api/media/generate-audio/route.ts");
    expect(content).toContain("adjustWalletBalance");
    expect(content).toContain("getCreditBalances");
    expect(content).not.toContain("getUserWallet");
    expect(content).not.toContain("updateWalletBalance");
  });

  it("generate-music uses adjustWalletBalance (not updateWalletBalance)", () => {
    const content = read("src/app/api/media/generate-music/route.ts");
    expect(content).toContain("adjustWalletBalance");
    expect(content).toContain("getCreditBalances");
    expect(content).not.toContain("getUserWallet");
    expect(content).not.toContain("updateWalletBalance");
  });

  it("generate-audio uses idempotency key", () => {
    const content = read("src/app/api/media/generate-audio/route.ts");
    expect(content).toContain("idempotencyKey");
  });

  it("generate-music uses idempotency key", () => {
    const content = read("src/app/api/media/generate-music/route.ts");
    expect(content).toContain("idempotencyKey");
  });
});

describe("Audio Lab — UI redesign", () => {
  it("AudioTool has Voiceover and Speech modes", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain('"voiceover"');
    expect(content).toContain('"speech"');
  });

  it("AudioTool has delivery controls", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("DELIVERY_OPTIONS");
    expect(content).toContain("PACING_OPTIONS");
  });

  it("AudioTool has Direct with LiTT feature", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("Direct with LiTT");
    expect(content).toContain("directedText");
  });

  it("AudioTool has voice cards with descriptions and best-for", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("bestFor");
    expect(content).toContain("Warm & clear");
  });

  it("AudioTool has waveform player with seek", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("handleSeek");
    expect(content).toContain("currentTime");
    expect(content).toContain("duration");
  });

  it("AudioTool has single authoritative audio player (no leaked Audio instances)", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("audioRef");
    // Must pause and clear src on cleanup
    expect(content).toContain("audioRef.current.src = \"\"");
  });

  it("AudioTool honors prefers-reduced-motion", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("useReducedMotion");
  });

  it("AudioTool has Remix feature", () => {
    const content = read("src/app/(app)/studio/tools/AudioTool.tsx");
    expect(content).toContain("handleRemix");
    expect(content).toContain("RotateCcw");
  });

  it("AudioTool accepts styleDirection from delivery controls", () => {
    const content = read("src/app/api/media/generate-audio/route.ts");
    expect(content).toContain("styleDirection");
  });
});
