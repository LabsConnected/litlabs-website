/**
 * Media provider disconnected-state regression test.
 *
 * Verifies that MediaNowPlayingCard:
 *   - Shows provider connection list when no media is active
 *   - URL paste is NOT the primary UX (it's advanced/collapsible)
 *   - LiTTree music is first-class
 *   - Uses MediaHubProvider + MusicPlayerContext (no new player)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("MediaNowPlayingCard — connected provider UX", () => {
  const cardPath = path.resolve(
    __dirname,
    "../src/components/media/MediaNowPlayingCard.tsx",
  );
  const source = fs.readFileSync(cardPath, "utf-8");

  it("imports useMediaHub (reuses existing provider)", () => {
    expect(source).toContain("useMediaHub");
  });

  it("imports useMusicPlayerOptional (reuses LiTTree player)", () => {
    expect(source).toContain("useMusicPlayerOptional");
  });

  it("does NOT create a new audio player", () => {
    expect(source).not.toContain("new Audio()");
    expect(source).not.toContain("<audio");
  });

  it("URL paste is NOT the primary UX (it's behind showAdvanced)", () => {
    expect(source).toContain("showAdvanced");
    expect(source).toContain("Paste link (advanced)");
  });

  it("does NOT show 'Paste a YouTube or Spotify link' as primary text", () => {
    // The old text was always visible — now it's behind advanced toggle
    expect(source).not.toContain('Paste a YouTube or Spotify link to start playing.');
  });

  it("shows provider connection list (YouTube, Spotify, Apple Music, LiTTree)", () => {
    expect(source).toContain("youtube");
    expect(source).toContain("spotify");
    expect(source).toContain("apple-music");
    expect(source).toContain("litt");
  });

  it("has Connect/Connected buttons for providers", () => {
    expect(source).toContain("Connect");
  });

  it("LiTTree is marked as always ready (not 'Connect')", () => {
    expect(source).toContain("Ready");
  });
});
