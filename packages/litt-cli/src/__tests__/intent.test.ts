/**
 * Tests for intent classification — CHAT vs COMMAND vs MISSION.
 *
 * Critical behavior:
 *   - Casual chat does NOT start a mission (no progress bar)
 *   - Slash commands are always "command"
 *   - Action words trigger "mission"
 */

import { describe, it, expect } from "vitest";
import { classifyIntent } from "../lib/intent.js";

describe("classifyIntent", () => {
  describe("command intent", () => {
    it("classifies slash commands as command", () => {
      expect(classifyIntent("/build")).toBe("command");
      expect(classifyIntent("/test")).toBe("command");
      expect(classifyIntent("/help")).toBe("command");
      expect(classifyIntent("/model")).toBe("command");
    });

    it("classifies slash commands with args as command", () => {
      expect(classifyIntent("/run pnpm build")).toBe("command");
      expect(classifyIntent("/route explain")).toBe("command");
    });
  });

  describe("chat intent", () => {
    it("classifies greetings as chat", () => {
      expect(classifyIntent("hi")).toBe("chat");
      expect(classifyIntent("hello")).toBe("chat");
      expect(classifyIntent("hey")).toBe("chat");
      expect(classifyIntent("sup")).toBe("chat");
      expect(classifyIntent("yo")).toBe("chat");
    });

    it("classifies casual phrases as chat", () => {
      expect(classifyIntent("whats up")).toBe("chat");
      expect(classifyIntent("what's up")).toBe("chat");
      expect(classifyIntent("how are you")).toBe("chat");
      expect(classifyIntent("who are you")).toBe("chat");
      expect(classifyIntent("what can you do")).toBe("chat");
    });

    it("classifies acknowledgments as chat", () => {
      expect(classifyIntent("thanks")).toBe("chat");
      expect(classifyIntent("thank you")).toBe("chat");
      expect(classifyIntent("ok")).toBe("chat");
      expect(classifyIntent("okay")).toBe("chat");
      expect(classifyIntent("cool")).toBe("chat");
      expect(classifyIntent("nice")).toBe("chat");
    });

    it("classifies questions as chat (when no action words)", () => {
      expect(classifyIntent("what is the meaning of life?")).toBe("chat");
      expect(classifyIntent("how does this work?")).toBe("chat");
      expect(classifyIntent("why is the sky blue?")).toBe("chat");
    });

    it("classifies short messages as chat", () => {
      expect(classifyIntent("hello there")).toBe("chat");
      expect(classifyIntent("bye")).toBe("chat");
    });
  });

  describe("mission intent", () => {
    it("classifies fix requests as mission", () => {
      expect(classifyIntent("fix the model picker enter key")).toBe("mission");
      expect(classifyIntent("fix the bug in auth")).toBe("mission");
    });

    it("classifies build requests as mission", () => {
      expect(classifyIntent("build the project")).toBe("mission");
      expect(classifyIntent("run the build")).toBe("mission");
    });

    it("classifies test requests as mission", () => {
      expect(classifyIntent("test the new feature")).toBe("mission");
      expect(classifyIntent("run tests")).toBe("mission");
    });

    it("classifies edit/refactor requests as mission", () => {
      expect(classifyIntent("edit the config file")).toBe("mission");
      expect(classifyIntent("refactor the auth module")).toBe("mission");
    });

    it("classifies implement/create requests as mission", () => {
      expect(classifyIntent("implement a new feature")).toBe("mission");
      expect(classifyIntent("create a new component")).toBe("mission");
    });

    it("classifies debug/inspect requests as mission", () => {
      expect(classifyIntent("debug the failing test")).toBe("mission");
      expect(classifyIntent("inspect the project structure")).toBe("mission");
    });

    it("classifies verify/check requests as mission", () => {
      expect(classifyIntent("verify the build works")).toBe("mission");
      expect(classifyIntent("check the type errors")).toBe("mission");
    });

    it("classifies scan/audit/diagnose requests as mission", () => {
      expect(classifyIntent("scan and see whats needed")).toBe("mission");
      expect(classifyIntent("scan the project")).toBe("mission");
      expect(classifyIntent("audit the repo")).toBe("mission");
      expect(classifyIntent("diagnose this project")).toBe("mission");
    });

    it("classifies long requests WITHOUT action words as chat (length is not execution)", () => {
      expect(classifyIntent("I need you to look into this really long request that doesn't have action words")).toBe("chat");
    });
  });

  describe("edge cases", () => {
    it("question with 'fix' is mission (not chat)", () => {
      expect(classifyIntent("can you fix the test?")).toBe("mission");
    });

    it("question with 'build' is mission (not chat)", () => {
      expect(classifyIntent("should we build this?")).toBe("mission");
    });

    it("short message with 'fix' is mission", () => {
      expect(classifyIntent("fix it")).toBe("mission");
    });

    it("short message with 'run' is mission", () => {
      expect(classifyIntent("run it")).toBe("mission");
    });
  });

  // ─── P0: speech acts must NEVER become missions ───────────────────
  // A mission word ("test", "build", "run") appearing inside the
  // content to repeat/say must not hijack a conversational request.
  describe("speech acts (response-only) are chat, not mission", () => {
    it("'Say exactly: LiTT model test successful' is chat", () => {
      expect(classifyIntent("Say exactly: LiTT model test successful")).toBe("chat");
    });

    it("'Reply with exactly: build passed' is chat", () => {
      expect(classifyIntent("Reply with exactly: build passed")).toBe("chat");
    });

    it("'Repeat: run tests' is chat", () => {
      expect(classifyIntent("Repeat: run tests")).toBe("chat");
    });

    it("'say hello world' is chat", () => {
      expect(classifyIntent("say hello world")).toBe("chat");
    });

    it("'reply OK' is chat", () => {
      expect(classifyIntent("Reply OK")).toBe("chat");
    });

    it("'respond with: deploy succeeded' is chat", () => {
      expect(classifyIntent("respond with: deploy succeeded")).toBe("chat");
    });

    it("'echo: run the build now' is chat", () => {
      expect(classifyIntent("echo: run the build now")).toBe("chat");
    });

    it("'answer with: test passed' is chat", () => {
      expect(classifyIntent("answer with: test passed")).toBe("chat");
    });

    it("politeness-wrapped speech act ('can you say: build ok') is chat", () => {
      expect(classifyIntent("can you say: build ok")).toBe("chat");
    });

    it("politeness-wrapped speech act ('please reply with: test done') is chat", () => {
      expect(classifyIntent("please reply with: test done")).toBe("chat");
    });
  });

  // ─── P0: informational requests are chat, not mission ────────────
  describe("informational requests are chat, not mission", () => {
    it("'Explain what npm run build does' is chat", () => {
      expect(classifyIntent("Explain what npm run build does")).toBe("chat");
    });

    it("'What does pnpm test do?' is chat", () => {
      expect(classifyIntent("What does pnpm test do?")).toBe("chat");
    });

    it("'explain how the test runner works' is chat", () => {
      expect(classifyIntent("explain how the test runner works")).toBe("chat");
    });

    it("'how do I run the tests?' is chat", () => {
      expect(classifyIntent("how do I run the tests?")).toBe("chat");
    });

    it("'what is a build step?' is chat", () => {
      expect(classifyIntent("what is a build step?")).toBe("chat");
    });

    it("'describe the deploy pipeline' is chat", () => {
      expect(classifyIntent("describe the deploy pipeline")).toBe("chat");
    });

    it("'summarize the test results' is chat", () => {
      expect(classifyIntent("summarize the test results")).toBe("chat");
    });

    it("politeness-wrapped info ('can you explain what build does') is chat", () => {
      expect(classifyIntent("can you explain what build does")).toBe("chat");
    });
  });

  // ─── P0: genuine action requests are STILL mission ───────────────
  // The fix must not weaken real mission detection.
  describe("genuine action requests remain mission", () => {
    it("'Run the tests' is mission", () => {
      expect(classifyIntent("Run the tests")).toBe("mission");
    });

    it("'Build the project' is mission", () => {
      expect(classifyIntent("Build the project")).toBe("mission");
    });

    it("'Test this repository' is mission", () => {
      expect(classifyIntent("Test this repository")).toBe("mission");
    });

    it("'Create hello.txt' is mission", () => {
      expect(classifyIntent("Create hello.txt")).toBe("mission");
    });

    it("'Inspect this repository' is mission", () => {
      expect(classifyIntent("Inspect this repository")).toBe("mission");
    });

    it("'run tests' is mission", () => {
      expect(classifyIntent("run tests")).toBe("mission");
    });

    it("'fix the bug' is mission", () => {
      expect(classifyIntent("fix the bug")).toBe("mission");
    });

    it("'deploy the app' is mission", () => {
      expect(classifyIntent("deploy the app")).toBe("mission");
    });
  });

  // ─── READ intent — bounded read-only project inspection ───────────
  describe("read intent — bounded project inspection queries", () => {
    it("'what framework is this' is read", () => {
      expect(classifyIntent("what framework is this")).toBe("read");
    });

    it("'what package manager is this' is read", () => {
      expect(classifyIntent("what package manager is this")).toBe("read");
    });

    it("'what scripts are available' is read", () => {
      expect(classifyIntent("what scripts are available")).toBe("read");
    });

    it("'what dependencies does this use' is read", () => {
      expect(classifyIntent("what dependencies does this use")).toBe("read");
    });

    it("'what files changed' is read", () => {
      expect(classifyIntent("what files changed")).toBe("read");
    });

    it("'show recent commits' is read", () => {
      expect(classifyIntent("show recent commits")).toBe("read");
    });

    it("'tell me the framework and branch' is read", () => {
      expect(classifyIntent("tell me the framework and branch")).toBe("read");
    });

    it("'what framework and branch is this' is read", () => {
      expect(classifyIntent("what framework and branch is this")).toBe("read");
    });

    it("'which package manager' is read", () => {
      expect(classifyIntent("which package manager")).toBe("read");
    });
  });

  describe("read vs chat boundary", () => {
    it("'what is TypeScript' is chat (general knowledge, not project state)", () => {
      expect(classifyIntent("what is TypeScript")).toBe("chat");
    });

    it("'what is the meaning of life' is chat (not project state)", () => {
      expect(classifyIntent("what is the meaning of life")).toBe("chat");
    });

    it("'explain what framework means' is chat (info prefix)", () => {
      expect(classifyIntent("explain what framework means")).toBe("chat");
    });

    it("'what does npm run build do' is chat (info prefix)", () => {
      expect(classifyIntent("what does npm run build do")).toBe("chat");
    });
  });

  describe("read vs mission boundary", () => {
    it("'inspect this repo and tell me the framework and branch' is mission", () => {
      expect(classifyIntent("inspect this repo and tell me the framework and branch")).toBe("mission");
    });

    it("'scan this repo and tell me what needs attention' is mission", () => {
      expect(classifyIntent("scan this repo and tell me what needs attention")).toBe("mission");
    });

    it("'audit the repo' is mission", () => {
      expect(classifyIntent("audit the repo")).toBe("mission");
    });

    it("'fix the framework' is mission", () => {
      expect(classifyIntent("fix the framework")).toBe("mission");
    });
  });
});
