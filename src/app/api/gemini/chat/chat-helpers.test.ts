/**
 * Tests for sanitizeResponse — post-processing sanitizer that catches
 * patterns the prompt prohibits but models still produce:
 *   1. Readiness openings ("I'm ready to go", "I'm here and ready", etc.)
 *   2. Placeholder names ([User's Name], [Name], [Member], [Friend])
 *   3. Voice responses exceeding the 3-sentence limit
 */

import { describe, it, expect } from "vitest";
import { sanitizeResponse } from "./chat-helpers";

describe("sanitizeResponse — placeholder stripping", () => {
  it("strips [User's Name] placeholder", () => {
    const result = sanitizeResponse("Hey [User's Name], what's on your mind?");
    expect(result).not.toContain("[User's Name]");
    expect(result).toBe("Hey, what's on your mind?");
  });

  it("strips [Name] placeholder", () => {
    const result = sanitizeResponse("Hi [Name], let's get started.");
    expect(result).not.toContain("[Name]");
    expect(result).toBe("Hi, let's get started.");
  });

  it("strips [Member] placeholder", () => {
    const result = sanitizeResponse("Hello [Member], how can I help?");
    expect(result).not.toContain("[Member]");
    expect(result).toBe("Hello, how can I help?");
  });

  it("strips [Friend] placeholder", () => {
    const result = sanitizeResponse("Hey [Friend], what's up?");
    expect(result).not.toContain("[Friend]");
    expect(result).toBe("Hey, what's up?");
  });

  it("strips [Username] placeholder", () => {
    const result = sanitizeResponse("Hi [Username], welcome back.");
    expect(result).not.toContain("[Username]");
    expect(result).toBe("Hi, welcome back.");
  });

  it("strips [Your Name] placeholder", () => {
    const result = sanitizeResponse("Hey [Your Name], glad you asked.");
    expect(result).not.toContain("[Your Name]");
    expect(result).toBe("Hey, glad you asked.");
  });

  it("strips multiple placeholders in one response", () => {
    const result = sanitizeResponse("Hey [User's Name], [Friend] is here too.");
    expect(result).not.toContain("[User's Name]");
    expect(result).not.toContain("[Friend]");
  });

  it("strips placeholder at the start of response", () => {
    const result = sanitizeResponse("[User's Name], glad you asked. Let's get started.");
    expect(result).not.toContain("[User's Name]");
    expect(result).toBe(", glad you asked. Let's get started.");
  });
});

describe("sanitizeResponse — readiness opening stripping", () => {
  it("strips 'I'm ready to go' opening", () => {
    const result = sanitizeResponse("I'm ready to go. We don't have a project loaded yet.");
    expect(result).not.toMatch(/^I'm ready/i);
    expect(result).toContain("We don't have a project");
  });

  it("strips 'Hello! I'm ready to go' opening", () => {
    const result = sanitizeResponse("Hello! I'm ready to go. What's on your mind?");
    expect(result).not.toMatch(/^I'm ready/i);
    expect(result).not.toMatch(/^Hello/i);
    expect(result).toContain("What's on your mind?");
  });

  it("strips 'I'm here and ready' opening", () => {
    const result = sanitizeResponse("I'm here and ready. GitHub is connected.");
    expect(result).not.toMatch(/^I'm here/i);
    expect(result).toContain("GitHub is connected.");
  });

  it("strips 'Thanks for checking in! I'm here and ready' opening", () => {
    const result = sanitizeResponse("Thanks for checking in! I'm here and ready. GitHub is connected.");
    expect(result).not.toMatch(/^Thanks for checking/i);
    expect(result).not.toMatch(/^I'm here/i);
    expect(result).toContain("GitHub is connected.");
  });

  it("strips 'Thanks for checking in!' opening", () => {
    const result = sanitizeResponse("Thanks for checking in! GitHub is connected and ready.");
    expect(result).not.toMatch(/^Thanks for checking/i);
    expect(result).toContain("GitHub is connected");
  });

  it("strips 'I'm here to help' opening", () => {
    const result = sanitizeResponse("I'm here to help with whatever you need. What's on your mind?");
    expect(result).not.toMatch(/^I'm here/i);
    expect(result).toContain("What's on your mind?");
  });

  it("strips 'Ready when you are' opening", () => {
    const result = sanitizeResponse("Ready when you are. We could start a new project.");
    expect(result).not.toMatch(/^Ready when/i);
    expect(result).toContain("We could start");
  });

  it("strips 'Just chilling' opening", () => {
    const result = sanitizeResponse("Just chilling. What do you need?");
    expect(result).not.toMatch(/^Just chilling/i);
    expect(result).toContain("What do you need?");
  });

  it("does not strip substance that happens to contain 'ready' mid-sentence", () => {
    const result = sanitizeResponse("Your repository is connected and ready for work.");
    expect(result).toContain("ready for work");
  });

  it("preserves response with no readiness opening", () => {
    const text = "Your GitHub repository is connected. We could start a new project.";
    const result = sanitizeResponse(text);
    expect(result).toBe(text);
  });
});

describe("sanitizeResponse — voice sentence limiting", () => {
  it("limits voice responses to 3 sentences", () => {
    const text = "GitHub is connected. Terminal is not connected. Voice is active. We could start a project. Or explore the repository.";
    const result = sanitizeResponse(text, "voice");
    const sentences = result.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it("does not limit text responses", () => {
    const text = "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence.";
    const result = sanitizeResponse(text, "text");
    const sentences = result.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBe(5);
  });

  it("does not truncate voice responses with 3 or fewer sentences", () => {
    const text = "GitHub is connected. Terminal is not connected. We could start a project.";
    const result = sanitizeResponse(text, "voice");
    expect(result).toBe(text);
  });

  it("handles voice response with readiness opening + sentence limiting", () => {
    const text = "I'm ready to go. GitHub is connected. Terminal is not connected. We could start a project. Or explore the repository.";
    const result = sanitizeResponse(text, "voice");
    expect(result).not.toMatch(/^I'm ready/i);
    const sentences = result.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });
});

describe("sanitizeResponse — combined sanitization", () => {
  it("strips placeholder + readiness opening together", () => {
    const result = sanitizeResponse(
      "I'm ready to go. Hey [User's Name], what's on your mind? We could start a project.",
    );
    expect(result).not.toContain("[User's Name]");
    expect(result).not.toMatch(/^I'm ready/i);
    expect(result).toContain("what's on your mind?");
  });

  it("strips placeholder + readiness + voice limiting together", () => {
    const result = sanitizeResponse(
      "I'm here to help. Hey [User's Name], GitHub is connected. Terminal is off. Voice is active. We could start a project. Or explore code.",
      "voice",
    );
    expect(result).not.toContain("[User's Name]");
    expect(result).not.toMatch(/^I'm here/i);
    const sentences = result.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it("returns empty string when entire response is a readiness phrase", () => {
    const result = sanitizeResponse("I'm ready to go.");
    expect(result).toBe("");
  });

  it("handles empty input", () => {
    expect(sanitizeResponse("")).toBe("");
  });

  it("handles whitespace-only input", () => {
    expect(sanitizeResponse("   ")).toBe("");
  });
});
