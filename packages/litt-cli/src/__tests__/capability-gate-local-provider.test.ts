import { describe, expect, it } from "vitest";

import { shouldBlockModelPath } from "../lib/capability-gate.js";

describe("capability gate: explicit local model availability", () => {
  it("allows signed-out local execution when a local model is available", () => {
    expect(
      shouldBlockModelPath(false, "local", false, true),
    ).toBe(false);
  });

  it("allows localOnly local execution when a local model is available", () => {
    expect(
      shouldBlockModelPath(false, "local", true, true),
    ).toBe(false);
  });

  it("blocks localOnly remote execution even when a local model exists", () => {
    expect(
      shouldBlockModelPath(true, "remote", true, true),
    ).toBe(true);
  });

  it("blocks signed-out local execution when no local model exists", () => {
    expect(
      shouldBlockModelPath(false, "local", false, false),
    ).toBe(true);
  });

  it("blocks localOnly local execution when no local model exists", () => {
    expect(
      shouldBlockModelPath(true, "local", true, false),
    ).toBe(true);
  });
});
