import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Truth-in-labels regression tests for the Settings surface.
// The settings page used to tell three lies about voice:
//   1. Config hints said "in Vercel env" — production runs on Railway.
//   2. The AI-models card advertised "Groq Whisper" transcription —
//      /api/media/transcribe runs Gemini (gemini-3.5-flash).
//   3. The LiveKit block claimed LiveKit is "the preferred transport
//      for Studio voice sessions" — Studio voice is Inworld-only.
// These tests scan the settings sources so the lies cannot creep back.

const settingsDir = __dirname;
const pageSource = readFileSync(path.join(settingsDir, "page.tsx"), "utf8");
const cardSource = readFileSync(
  path.join(settingsDir, "VoicePreferencesCard.tsx"),
  "utf8",
);
const settingsSurface = `${pageSource}\n${cardSource}`;

describe("settings voice labels tell the truth", () => {
  it("never points operators at Vercel env (production is Railway)", () => {
    expect(settingsSurface).not.toContain("Vercel env");
    expect(pageSource).toContain("Railway");
  });

  it("names the real transcription provider (Gemini), not Groq Whisper", () => {
    expect(settingsSurface).not.toContain("Groq Whisper");
    expect(pageSource).toContain("gemini-3.5-flash");
  });

  it("never claims LiveKit is the Studio voice transport", () => {
    expect(settingsSurface).not.toContain(
      "preferred transport for Studio voice sessions",
    );
    expect(settingsSurface).not.toContain("preferred realtime transport");
  });
});
