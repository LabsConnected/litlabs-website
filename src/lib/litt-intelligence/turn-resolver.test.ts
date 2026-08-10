import { describe, it, expect } from "vitest";
import { resolveTurn, type ConversationTurn } from "./turn-resolver";

describe("Turn Resolver", () => {
  it("returns non-ambiguous messages as-is with high confidence", () => {
    const result = resolveTurn("Build me a landing page with a hero section", []);
    expect(result.resolved).toBe("Build me a landing page with a hero section");
    expect(result.confidence).toBe(1.0);
  });

  it("expands 'why' questions using conversation context", () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "Why aren't voice and text the same?" },
      { role: "assistant", content: "Voice uses Gemini Live, text uses LiTT Runtime." },
    ];
    const result = resolveTurn("why aint it the same as text", history);
    expect(result.resolved).toContain("why aint it the same as text");
    expect(result.resolved).toContain("Why aren't voice and text the same?");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("expands 'fix that' references", () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "My mobile dashboard looks bad" },
      { role: "assistant", content: "I see the issue in `MobileDashboard.tsx`. The layout is broken." },
    ];
    const result = resolveTurn("fix that shit", history);
    expect(result.resolved).toContain("fix that shit");
    expect(result.resolved).toContain("MobileDashboard");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("expands 'no the other one' corrections", () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "Make the button blue" },
      { role: "assistant", content: "I made the header button blue." },
    ];
    const result = resolveTurn("no the other one", history);
    expect(result.resolved).toContain("Make the button blue");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("expands 'same problem as before'", () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "The build is failing with a type error" },
      { role: "assistant", content: "Fixed the type error in utils.ts." },
    ];
    const result = resolveTurn("same problem as before", history);
    expect(result.resolved).toContain("type error");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("returns low confidence when ambiguous but no history", () => {
    const result = resolveTurn("fix it", []);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("does not expand long, self-contained messages", () => {
    const longMsg = "Can you scan my repository and tell me what the architecture looks like? I want to understand the data flow.";
    const result = resolveTurn(longMsg, []);
    expect(result.resolved).toBe(longMsg);
    expect(result.confidence).toBe(1.0);
  });

  it("expands 'make this better' with context", () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "Create a hero section for my landing page" },
      { role: "assistant", content: "I created a hero section with a gradient background." },
    ];
    const result = resolveTurn("make this better", history);
    expect(result.resolved).toContain("hero section");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("expands 'dont' corrections", () => {
    const history: ConversationTurn[] = [
      { role: "user", content: "Add a sidebar to the dashboard" },
      { role: "assistant", content: "I added a sidebar with navigation links." },
    ];
    const result = resolveTurn("dont open image just make it here", history);
    expect(result.resolved).toContain("sidebar");
    expect(result.confidence).toBeGreaterThan(0.7);
  });
});
