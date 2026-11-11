import { describe, expect, it, vi } from "vitest";
import {
  buildIntentResponseMessage,
  detectIntent,
  dispatchStudioIntent,
  extractMediaPrompt,
  type StudioIntentHandlers,
} from "./studio-intent";

/**
 * generate_music — the one-chat music flow (ART-20261111-035).
 *
 * Mirrors the P1-1 image/video contract exactly: a music request typed
 * in the ONE chat opens the real Music pane with the request staged
 * (read-only) — it must never route through onRouteToolAction("music"),
 * which normalizes to a placeholder surface, and it must not steal
 * code/video/image requests that merely mention music.
 */

function spies() {
  return {
    onRouteToolAction: vi.fn(),
    onRouteInspectorAction: vi.fn(),
    onRunHealthChecks: vi.fn(),
    onOpenProjectNameDialog: vi.fn(),
    onOpenImageStudio: vi.fn(),
    onOpenVideoStudio: vi.fn(),
    onOpenMusicStudio: vi.fn(),
    onNavigate: vi.fn(),
  } satisfies StudioIntentHandlers;
}

describe("generate_music intent classification", () => {
  it.each([
    ["make me a dark trap song", "dark trap song"],
    ["generate a song about rainy nights in the city", "rainy nights in the city"],
    ["make a beat", "make a beat"],
    ["compose an orchestral track for a film trailer", "orchestral track for a film trailer"],
    ["write me an anthem for the shop", "the shop"],
  ])("classifies %s as generate_music with staged prompt %s", (text, prompt) => {
    const intent = detectIntent(text);
    expect(intent?.intent).toBe("generate_music");
    expect(intent?.tool).toBe("music");
    expect(intent?.prompt).toBe(prompt);
  });

  it("extractMediaPrompt cleans music requests like image/video", () => {
    expect(extractMediaPrompt("make me a dark trap song", "music")).toBe("dark trap song");
    expect(extractMediaPrompt("please generate a ballad about the lake", "music")).toBe(
      "the lake",
    );
  });

  it.each([
    "make a music video of my song",
    "make a video of a song",
    "how does music generation work?",
    "write a storyboard for a video",
  ])("does not route %s to the Music Studio", (text) => {
    expect(detectIntent(text)).not.toMatchObject({ intent: "generate_music" });
  });

  it("does not steal build requests that mention music", () => {
    expect(detectIntent("build a music streaming app")?.intent).toBe("generate_code");
    expect(
      detectIntent(
        "Create a responsive landing page for a fictional Michigan music venue. Show me the finished preview.",
      )?.intent,
    ).toBe("generate_code");
  });
});

describe("generate_music dispatch — the real surface-open action fires", () => {
  it("opens the real Music Studio with the staged prompt; no legacy tool routing", () => {
    const h = spies();
    const intent = detectIntent("make me a dark trap song");
    expect(intent).not.toBeNull();
    dispatchStudioIntent(intent!, h);
    expect(h.onOpenMusicStudio).toHaveBeenCalledTimes(1);
    expect(h.onOpenMusicStudio).toHaveBeenCalledWith("dark trap song");
    expect(h.onRouteToolAction).not.toHaveBeenCalled();
    expect(h.onOpenImageStudio).not.toHaveBeenCalled();
    expect(h.onOpenVideoStudio).not.toHaveBeenCalled();
  });

  it("assistant copy says exactly what happened", () => {
    const intent = detectIntent("make me a dark trap song");
    expect(buildIntentResponseMessage(intent!, { terminalConnected: true })).toBe(
      "Opening the music studio.",
    );
  });
});
