import { describe, it, expect, beforeEach } from "vitest";
import {
  AGENT_SETTINGS_STORAGE_KEY,
  isAgentHidden,
  readHiddenAgents,
  visibleAgents,
} from "../agent-visibility";

describe("agent-visibility", () => {
  beforeEach(() => {
    window.localStorage.removeItem(AGENT_SETTINGS_STORAGE_KEY);
  });

  describe("isAgentHidden", () => {
    it("returns true only for listed agent ids", () => {
      expect(isAgentHidden(["spark"], "spark")).toBe(true);
      expect(isAgentHidden(["spark"], "litt")).toBe(false);
      expect(isAgentHidden([], "spark")).toBe(false);
    });
  });

  describe("visibleAgents", () => {
    const agents = [{ id: "litt" }, { id: "spark" }];

    it("returns all agents when nothing is hidden", () => {
      expect(visibleAgents(agents, [])).toEqual(agents);
    });

    it("filters out hidden agents", () => {
      expect(visibleAgents(agents, ["spark"])).toEqual([{ id: "litt" }]);
    });

    it("ignores unknown ids in the hidden list", () => {
      expect(visibleAgents(agents, ["nope"])).toEqual(agents);
    });
  });

  describe("readHiddenAgents", () => {
    it("returns [] when nothing is stored", () => {
      expect(readHiddenAgents()).toEqual([]);
    });

    it("reads the hiddenAgents array from agent settings", () => {
      window.localStorage.setItem(
        AGENT_SETTINGS_STORAGE_KEY,
        JSON.stringify({ defaultAgent: "litt", hiddenAgents: ["spark"] }),
      );
      expect(readHiddenAgents()).toEqual(["spark"]);
    });

    it("ignores non-array or non-string values", () => {
      window.localStorage.setItem(
        AGENT_SETTINGS_STORAGE_KEY,
        JSON.stringify({ hiddenAgents: "spark" }),
      );
      expect(readHiddenAgents()).toEqual([]);
      window.localStorage.setItem(
        AGENT_SETTINGS_STORAGE_KEY,
        JSON.stringify({ hiddenAgents: ["spark", 42] }),
      );
      expect(readHiddenAgents()).toEqual(["spark"]);
    });

    it("returns [] on malformed JSON", () => {
      window.localStorage.setItem(AGENT_SETTINGS_STORAGE_KEY, "{nope");
      expect(readHiddenAgents()).toEqual([]);
    });
  });
});
