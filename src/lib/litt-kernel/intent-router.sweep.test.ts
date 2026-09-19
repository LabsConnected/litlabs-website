/**
 * Intent-router sweep regression tests.
 *
 * Covers the 9 misrouting gaps found by adversarial fuzzing of the real
 * classifyIntent on origin/main: each of these user messages asked for
 * something to be built and was routed to a text-only chat reply (mode
 * `create` with requiresExecution=false, or `think`/`research` defaults) —
 * so nothing was ever built. They must all land in `build` mode with
 * requiresExecution=true (or, for bare anaphoric follow-ups, be flagged so
 * the caller can ask a targeted clarification).
 *
 * Run: npx vitest run src/lib/litt-kernel/intent-router.sweep.test.ts
 */
import { describe, it, expect } from "vitest";
import { classifyIntent } from "@/lib/litt-kernel/intent-router";
import { routeKernel } from "@/lib/litt-kernel/kernel";

function buildCase(message: string) {
  const r = classifyIntent(message);
  expect(r.mode).toBe("build");
  expect(r.requiresExecution).toBe(true);
  expect(r.requiresProject).toBe(true);
  return r;
}

describe("intent-router sweep — build phrasings misrouted to chat", () => {
  // 1. Question-form desire: "what about a landing page for my barbershop?"
  it("question-form desire routes to build, not create", () => {
    buildCase("what about a landing page for my barbershop?");
    buildCase("how about a blog for my bakery?");
  });

  // 2. "can you redesign my homepage"
  it("redesign/revamp/restyle/overhaul verbs route to build", () => {
    buildCase("can you redesign my homepage");
    buildCase("revamp the landing page");
    buildCase("restyle my site");
    buildCase("overhaul the homepage");
  });

  // 3. "make the button lime"
  it("make/set + UI element routes to build", () => {
    buildCase("make the button lime");
    buildCase("set the cta text to Buy Now");
  });

  // 4. "fix the header on my site" (fix|repair + product target)
  it("fix/repair + product target routes to build", () => {
    buildCase("fix the header on my site");
    buildCase("repair the nav on my homepage");
  });

  // 5. "now add a contact section" (continuation verb beats research "now")
  it("continuation verbs route to build, not research", () => {
    buildCase("now add a contact section");
    buildCase("then remove the footer");
    buildCase("also update the hero");
  });

  // 7. "gimme a portfolio site"
  it("gimme + artifact routes to build", () => {
    buildCase("gimme a portfolio site");
  });

  // 8. "landing page. puppet master theme. go." (terse imperative)
  it("terse imperative with artifact noun routes to build", () => {
    buildCase("landing page. puppet master theme. go.");
    buildCase("portfolio. dark theme. build it.");
  });

  // 9. "add images and cool shit to my project" (media into project target)
  it("media added to a project target routes to build", () => {
    buildCase("add images and cool shit to my project");
    buildCase("upload photos to my site");
  });

  // 6. Anaphoric follow-ups: no artifact noun + it/that/those/these/again
  describe("anaphoric follow-up marker", () => {
    it("marks 'build it' as an anaphoric follow-up", () => {
      const r = classifyIntent("build it", { hasProject: true });
      expect(r.anaphoricFollowUp).toBe(true);
    });

    it("marks 'do that thing again but lime' as an anaphoric follow-up", () => {
      const r = classifyIntent("do that thing again but lime", { hasProject: true });
      expect(r.anaphoricFollowUp).toBe(true);
    });

    it("does not mark messages that name an artifact noun", () => {
      expect(classifyIntent("build a landing page").anaphoricFollowUp).toBe(false);
      expect(classifyIntent("make the button lime").anaphoricFollowUp).toBe(false);
    });

    it("does not mark plain chat", () => {
      expect(classifyIntent("what is a webhook").anaphoricFollowUp).toBe(false);
    });

    it("flows from the Kernel into the decision routing when a project exists", () => {
      const result = routeKernel({
        message: "build it",
        userId: null,
        conversationId: "conv_1",
        projectId: "proj_1",
        missionId: null,
        canvasId: null,
        capabilities: [],
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.decision.routing.anaphoricFollowUp).toBe(true);
      }
    });

    it("is text-driven (not project-gated) but annotated when a project exists", () => {
      const withProj = classifyIntent("build it", { hasProject: true });
      expect(withProj.anaphoricFollowUp).toBe(true);
      expect(withProj.reasoning).toContain("with project context");
      const withoutProj = classifyIntent("build it", { hasProject: false });
      expect(withoutProj.anaphoricFollowUp).toBe(true);
      expect(withoutProj.reasoning).not.toContain("with project context");
    });
  });

  // ─── Must-not-break negatives ───
  describe("negatives (must not disturb)", () => {
    it("'can u make me a logo' stays create (media, no project target)", () => {
      const r = classifyIntent("can u make me a logo");
      expect(r.mode).toBe("create");
      expect(r.requiresExecution).toBe(false);
    });

    it("'i need sumthin for my biz' stays think (genuinely ambiguous)", () => {
      const r = classifyIntent("i need sumthin for my biz");
      expect(r.mode).toBe("think");
    });

    it("'I want to shop for shoes' stays think (not a build)", () => {
      const r = classifyIntent("I want to shop for shoes");
      expect(r.mode).toBe("think");
      expect(r.requiresExecution).toBe(false);
    });

    it("media generation without a project target stays create", () => {
      const r = classifyIntent("generate an image of my dog");
      expect(r.mode).toBe("create");
    });

    it("'redesign my logo' stays create (logo is not a site target)", () => {
      const r = classifyIntent("redesign my logo");
      expect(r.mode).toBe("create");
    });
  });
});
