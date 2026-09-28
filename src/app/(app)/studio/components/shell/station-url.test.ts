import { describe, it, expect } from "vitest";
import {
  CENTER_STATIONS,
  centerStation,
  resolveInitialStation,
  stationToToolParam,
  toolParamToStation,
} from "./station-url";

describe("station ⟷ URL", () => {
  it("every center station round-trips through ?tool=", () => {
    for (const s of CENTER_STATIONS) {
      expect(toolParamToStation(stationToToolParam(s))).toBe(s);
    }
  });

  it("tool=preview always means the Preview station", () => {
    expect(toolParamToStation("preview")).toBe("preview");
  });

  it("plan is never a center station", () => {
    expect(CENTER_STATIONS).not.toContain("plan");
    expect(centerStation("plan")).toBe("preview");
    expect(stationToToolParam("plan")).toBe("preview");
    expect(toolParamToStation("plan")).toBe("preview");
  });

  it("assets never round-trips into the non-studio Assets page", () => {
    expect(stationToToolParam("assets")).not.toBe("assets");
  });

  it("unknown tools make no station claim", () => {
    expect(toolParamToStation(null)).toBeNull();
    expect(toolParamToStation("agents")).toBeNull();
    expect(toolParamToStation("workflows")).toBeNull();
  });

  it("an explicit deep link beats the remembered task surface", () => {
    // The acceptance failure: task remembered "plan", URL said preview.
    expect(resolveInitialStation("preview", "plan")).toBe("preview");
    expect(resolveInitialStation("browser", "code")).toBe("browser");
    expect(resolveInitialStation(null, "code")).toBe("code");
    expect(resolveInitialStation(null, "plan")).toBe("preview");
    expect(resolveInitialStation(undefined, null)).toBe("preview");
  });
});
