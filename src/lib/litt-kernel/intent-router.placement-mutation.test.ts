import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";

/**
 * Regression test for the 2026-09-18 production acceptance dead-end.
 *
 * Bug: a customer asked Studio to place a generated image on the site with
 * everyday phrasing ("Now put the puppy image onto the site's homepage").
 * classifyIntent routed it to `research` — the leading "Now" matched the
 * recency word list — so requiresExecution=false, the V2 tool loop never
 * activated, and the model truthfully answered "I have no tool access".
 * Other phrasings ("Put…", "Add…", "Insert…") fell into `create`, which
 * also lacks requiresExecution. The customer journey dead-ended with the
 * generated asset saved but never wired into the site.
 *
 * Expected: placement/mutation commands that name a site surface must
 * classify as "build" with requiresExecution=true, regardless of whether
 * the user says "update"/"edit" or uses everyday verbs.
 */
describe("placement-mutation prompts — execution routing", () => {
  const CASES: Array<{ msg: string; note: string }> = [
    { msg: "Put this image on my homepage", note: "put + homepage" },
    { msg: "Add that image to the hero", note: "add + hero" },
    { msg: "Use the generated image on the website", note: "use + website" },
    { msg: "Now put the puppy image on the homepage", note: "leading 'Now' must not hijack to research" },
    { msg: "Place this picture in the top section", note: "place + section" },
    { msg: "Insert the image into this page", note: "insert + page" },
  ];

  for (const { msg, note } of CASES) {
    it(`classifies "${msg}" as build + requiresExecution (${note})`, () => {
      const result = classifyIntent(msg);
      expect(result.mode).toBe("build");
      expect(result.requiresExecution).toBe(true);
      expect(result.requiresProject).toBe(true);
    });
  }

  it("does not route any placement phrasing to research or create", () => {
    for (const { msg } of CASES) {
      const result = classifyIntent(msg);
      expect(["research", "create"]).not.toContain(result.mode);
    }
  });

  it("covers the original production failure verbatim", () => {
    const result = classifyIntent(
      "Now put the puppy image you generated onto the site's homepage hero section.",
    );
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
  });

  it("still routes a combined generate+place request to build", () => {
    const result = classifyIntent(
      "Generate a golden retriever puppy image and put it on my homepage.",
    );
    expect(result.mode).toBe("build");
    expect(result.requiresExecution).toBe(true);
  });

  // ── Non-mutation phrasing must NOT be pulled into build ──

  it("keeps pure research phrasing on research (no false positive)", () => {
    const result = classifyIntent("What's the latest on the market today?");
    expect(result.mode).toBe("research");
    expect(result.requiresExecution).toBe(false);
  });

  it("keeps image generation phrasing on create (no false positive)", () => {
    const result = classifyIntent("Generate a logo for my brand");
    expect(result.mode).toBe("create");
    expect(result.requiresExecution).toBe(false);
  });

  it("does not treat 'show me' informational requests as site mutations", () => {
    const result = classifyIntent("Show me the price of the Pro plan");
    expect(result.mode).not.toBe("build");
  });
});
