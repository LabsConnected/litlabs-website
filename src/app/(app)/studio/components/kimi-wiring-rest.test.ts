import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

import { isMediaPath } from "./StudioProjectFiles";
import { formatSavedAgo } from "./code/CodeWorkspace";

/**
 * Kimi wiring items 7 + 15 pure helpers.
 *
 * isMediaPath decides which Files-panel opens route to the Media
 * surface instead of the text editor — it must cover the image /
 * video / audio extensions the Asset Lake classifies by, and nothing
 * else (a .ts file must never route to Media).
 *
 * formatSavedAgo phrases the Code panel's save-status line from the
 * timestamp saveFile recorded.
 */
describe("isMediaPath (item 7 media routing)", () => {
  it("routes image, video and audio extensions", () => {
    for (const path of [
      "assets/hero.png",
      "photo.JPG",
      "icon.svg",
      "clip.mp4",
      "demo.webm",
      "song.mp3",
      "voice.m4a",
      "track.flac",
    ]) {
      expect(isMediaPath(path), path).toBe(true);
    }
  });

  it("never routes code or text files", () => {
    for (const path of ["src/index.ts", "README.md", "styles.css", "data.json", "no-extension"]) {
      expect(isMediaPath(path), path).toBe(false);
    }
  });
});

describe("formatSavedAgo (item 15 save-status line)", () => {
  const at = 1_000_000_000_000;

  it("says 'just now' under five seconds", () => {
    expect(formatSavedAgo(at, at)).toBe("just now");
    expect(formatSavedAgo(at, at + 4_999)).toBe("just now");
  });

  it("counts seconds, minutes and hours", () => {
    expect(formatSavedAgo(at, at + 30_000)).toBe("30s ago");
    expect(formatSavedAgo(at, at + 5 * 60_000)).toBe("5m ago");
    expect(formatSavedAgo(at, at + 3 * 3_600_000)).toBe("3h ago");
  });

  it("never goes negative when clocks skew", () => {
    expect(formatSavedAgo(at, at - 60_000)).toBe("just now");
  });
});
