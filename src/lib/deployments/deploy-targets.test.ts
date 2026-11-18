import { describe, it, expect } from "vitest";

import {
  normalizeDeployTargetInput,
  rowTargetForChoice,
  choiceForRowTarget,
  deployTargetLabel,
} from "./deploy-targets";
import { HOSTING_TARGET } from "./litt-hosting";

describe("deploy target vocabulary", () => {
  it("pins the litt choice to the canonical HOSTING_TARGET row value", () => {
    expect(rowTargetForChoice("litt")).toBe(HOSTING_TARGET);
    expect(rowTargetForChoice("netlify")).toBe("netlify");
  });

  it("normalizes only the exact \"netlify\" value to the netlify choice", () => {
    expect(normalizeDeployTargetInput("netlify")).toBe("netlify");
    expect(normalizeDeployTargetInput("litt")).toBe("litt");
    expect(normalizeDeployTargetInput(undefined)).toBe("litt");
    expect(normalizeDeployTargetInput(null)).toBe("litt");
    expect(normalizeDeployTargetInput("NETLIFY")).toBe("litt");
    expect(normalizeDeployTargetInput("vercel")).toBe("litt");
    expect(normalizeDeployTargetInput(42)).toBe("litt");
  });

  it("round-trips row targets and labels both targets", () => {
    expect(choiceForRowTarget(rowTargetForChoice("litt"))).toBe("litt");
    expect(choiceForRowTarget(rowTargetForChoice("netlify"))).toBe("netlify");
    expect(choiceForRowTarget("something-else")).toBeNull();
    expect(deployTargetLabel("litt")).toBe("LiTT Hosting");
    expect(deployTargetLabel("netlify")).toBe("Netlify");
  });
});
