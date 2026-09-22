import { describe, expect, it } from "vitest";
import { routeIntent } from "./router";

describe("LiTT intent router", () => {
  it("routes a song request to music without a mode menu", async () => {
    const output = await routeIntent({ prompt: "make me a song", context: {} });
    expect(output.type).toBe("intent");
    if (output.type === "intent") expect(output.result.primaryIntent).toBe("music");
  });

  it("uses selected asset context for a contextual edit", async () => {
    const output = await routeIntent({ prompt: "make the logo darker", context: { selectedAssetId: "asset-1" } });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.primaryIntent).toBe("image");
      expect(output.result.action).toBe("edit");
    }
  });

  it("routes a failed deployment fix to debug", async () => {
    const output = await routeIntent({ prompt: "fix it", context: { activeProjectId: "project-1", deploymentState: "failed" } });
    expect(output.type).toBe("intent");
    if (output.type === "intent") expect(output.result.primaryIntent).toBe("debug");
  });

  it("asks one useful clarification for vague context-free requests", async () => {
    const output = await routeIntent({ prompt: "make it better", context: {} });
    expect(output).toEqual({
      type: "clarification",
      request: { question: "What should LiTT work on? Tell me the project, file, asset, or result you want changed." },
    });
  });

  it("marks destructive requests for approval", async () => {
    const output = await routeIntent({ prompt: "delete production", context: { activeProjectId: "project-1" } });
    expect(output.type).toBe("intent");
    if (output.type === "intent") {
      expect(output.result.consequence).toBe("destructive");
      expect(output.result.requirements.needsApproval).toBe(true);
    }
  });
});
