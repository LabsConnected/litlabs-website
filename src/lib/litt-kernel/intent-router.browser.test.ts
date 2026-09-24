import { describe, expect, it } from "vitest";
import { classifyIntent } from "./intent-router";

/**
 * Browser lane regression coverage.
 *
 * Bug: browser-control requests fell through to think mode →
 * requiresExecution:false → the messages route skipped V2 → the V1
 * read-only loop has no browser tools → the model confabulated
 * "browser sessions aren't available in this environment."
 *
 * These tests pin the intent CLASS (session lifecycle, control
 * handoff, navigation-through-browser), not just the exact phrases
 * that first exposed the bug.
 */
describe("classifyIntent — browser lane", () => {
  describe("routes to browser mode with requiresExecution", () => {
    const cases = [
      // Required phrases
      "open a live browser",
      "start a browser session",
      "browse this site for me",
      "take me to this URL in the browser",
      // Paraphrases — same intent class, different wording
      "launch a browser and go to example.com",
      "take over the browser for me",
      "can you open a live browser session and go to example.com",
      "spin up a browser",
      "can you spin up a browser",
      "can you bring up a browser for me",
      "fire up a remote browser",
      "use the browser to check the dashboard",
      "navigate the browser to the preview URL",
      "go to https://example.com in the browser",
      "call browser.session.start",
      "show me this page in the browser",
      "let me drive the browser",
      "give control back to the agent",
    ];
    it.each(cases)("%s", (message) => {
      const result = classifyIntent(message);
      expect(result.mode).toBe("browser");
      expect(result.requiresExecution).toBe(true);
      expect(result.requiresProject).toBe(false);
    });
  });

  describe("does not steal other lanes", () => {
    it("'is the browser working?' stays status", () => {
      expect(classifyIntent("is the browser working?").mode).toBe("status");
    });

    it("'the browser looks broken' stays status", () => {
      expect(classifyIntent("the browser looks broken").mode).toBe("status");
    });

    it("'up' as a status predicate stays status", () => {
      // The modal+"up" collision fix: "up" is a status word only as the
      // predicate, not as part of a phrasal launch verb.
      expect(classifyIntent("is the server up").mode).toBe("status");
      expect(classifyIntent("is it back up yet?").mode).toBe("status");
      expect(classifyIntent("will it be up soon").mode).toBe("status");
      expect(classifyIntent("the browser is up").mode).toBe("status");
    });

    it("'what browser do you use?' stays a knowledge question", () => {
      const result = classifyIntent("what browser do you use?");
      expect(result.mode).not.toBe("browser");
      expect(result.requiresExecution).toBe(false);
    });

    it("a build request that mentions a browser artifact stays build", () => {
      expect(classifyIntent("add a browser settings page to the app").mode).toBe("build");
      expect(classifyIntent("build me a website with a browser preview").mode).toBe("build");
      expect(classifyIntent("build a browser extension").mode).toBe("build");
    });

    it("a media/design request mentioning browser stays create", () => {
      expect(classifyIntent("create a browser mockup for the pitch deck").mode).toBe("create");
    });

    it("generic messages still fall back to think", () => {
      expect(classifyIntent("help me plan the roadmap").mode).toBe("think");
    });
  });
});
