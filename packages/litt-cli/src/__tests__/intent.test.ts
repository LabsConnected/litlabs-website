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

    it("classifies long requests as mission by default", () => {
      expect(classifyIntent("I need you to look into this really long request that doesn't have action words")).toBe("mission");
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
});
