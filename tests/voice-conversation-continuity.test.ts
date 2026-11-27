// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildVoiceConversationContext,
  type VoiceHistoryMessage,
} from "@/lib/voice/voice-conversation-context";

function exchange(user: string, assistant: string): VoiceHistoryMessage[] {
  return [{ role: "user", content: user }, { role: "assistant", content: assistant }];
}

describe("Voice conversation continuity", () => {
  it("preserves the last four exchanges as ordered messages", () => {
    const all = Array.from({ length: 8 }, (_, n) =>
      exchange(`Question ${n + 1}`, `Answer ${n + 1}`),
    ).flat();
    const result = buildVoiceConversationContext(all, "Another question");
    expect(result.recent).toEqual(all.slice(-8));
    expect(result.recent.map((entry) => entry.role)).toEqual([
      "user", "assistant", "user", "assistant",
      "user", "assistant", "user", "assistant",
    ]);
  });

  it("retrieves relevant older facts even after the recent-history boundary", () => {
    const all = [
      ...exchange("My dog's name is Miso", "Got it, your dog's name is Miso."),
      ...exchange("Let's discuss the dashboard", "Sure."),
      ...exchange("What about page layout?", "A two-column layout works."),
      ...exchange("Can you explain deployment?", "Railway deploys your site."),
      ...exchange("How about preview?", "Preview is separate."),
      ...exchange("Any tips for colors?", "Purple and orange."),
      ...exchange("Can we discuss icons?", "Let's focus on the favicon."),
    ];
    const result = buildVoiceConversationContext(all, "What is my dog's name again?");
    expect(result.recent).not.toContainEqual({ role: "user", content: "My dog's name is Miso" });
    expect(result.earlierContext).toContain("My dog's name is Miso");
    expect(result.earlierContext).toContain("Got it, your dog's name is Miso.");
  });

  it("carries an older answered topic so follow-ups can avoid replaying it", () => {
    const all = [
      ...exchange("Explain Railway rollback steps", "Use a known-good deployment to roll back."),
      ...Array.from({ length: 7 }, (_, n) => exchange(`Unrelated prompt ${n}`, `Answer ${n}`)).flat(),
    ];
    const result = buildVoiceConversationContext(all, "What else about Railway rollback?");
    expect(result.earlierContext).toContain("Explain Railway rollback steps");
    expect(result.earlierContext).toContain("Use a known-good deployment");
  });

  it("does not invent or transform details, and bounds old excerpts", () => {
    const all = [
      ...exchange("Keep this goal: " + "x".repeat(500), "Understood: " + "y".repeat(500)),
      ...Array.from({ length: 70 }, (_, n) => exchange(`Subject ${n}`, `Response ${n}`)).flat(),
    ];
    const result = buildVoiceConversationContext(all, "What is our goal?");
    expect(result.recent).toEqual(all.slice(-8));
    expect(result.earlierContext).toContain("Keep this goal:");
    expect(result.earlierContext.length).toBeLessThan(1800);
    expect(result.earlierContext).not.toContain("x".repeat(500));
  });

  it("returns empty older context on a short conversation", () => {
    const all = exchange("Hello", "Hi!");
    expect(buildVoiceConversationContext(all, "Tell me more")).toEqual({
      recent: all,
      earlierContext: "",
    });
  });

  it("voice prompt allows explicit repeats and keeps #638 pronunciation", () => {
    const source = readFileSync("src/lib/voice/voice-runtime.ts", "utf8");
    expect(source).toContain("unless the caller asks you to repeat or recap it");
    expect(source).toContain("adding only what is new or relevant");
    expect(source).toContain("pronounced as one syllable: 'lit'");
    expect(source).toContain("ctx.voiceEarlierContext");
    expect(source).toContain("buildVoiceConversationContext(completed, message)");
  });

  it("Vapi turn awaits both history writes instead of detaching them", () => {
    const route = readFileSync("src/app/api/vapi/turn/route.ts", "utf8");
    expect(route).toContain("const savedUser = await insertMessage(");
    expect(route).toContain("const savedAssistant = await insertMessage(");
    expect(route).not.toContain("void (async () => {\n      try {\n        await insertMessage(");
  });
});
