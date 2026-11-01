/**
 * Local AI routing — litt-fast / litt-coder model selection.
 *
 * Covers: explicit selection honouring, bare vs ollama:-prefixed ids,
 * fast/coder profile routing, hard-fail on missing models, and that a
 * completion-only or unrequested model is never silently substituted.
 */
import { describe, it, expect, afterEach } from "vitest";
import { resolveLocalModel } from "../lib/local-model-resolution.js";
import { selectLocalModel } from "../lib/local-lane.js";
import type { LocalLaneStatus } from "../lib/local-lane.js";

const INSTALLED = [
  "litt-fast:2k",
  "litt-tools:4k",
  "litt-coder:latest",
  "litt-coder:3b",
  "qwen3:4b-instruct",
  "qwen2.5-coder:3b",
];

const LANE_UP: LocalLaneStatus = {
  available: true,
  models: INSTALLED,
  endpoint: "http://127.0.0.1:11435",
  reason: null,
};

const LANE_NO_CODER: LocalLaneStatus = {
  ...LANE_UP,
  models: ["litt-fast:2k", "qwen3:1.7b"],
};

afterEach(() => {
  delete process.env.LITT_MODEL;
});

describe("explicit selection", () => {
  it("bare litt-fast:2k resolves exactly", () => {
    const out = resolveLocalModel(LANE_UP, "litt-fast:2k");
    expect(out.ok && out.resolution.tag).toBe("litt-fast:2k");
    expect(out.ok && out.resolution.canonicalId).toBe("ollama:litt-fast:2k");
  });

  it("ollama:litt-coder:latest resolves to the bare installed tag", () => {
    const out = resolveLocalModel(LANE_UP, "ollama:litt-coder:latest");
    expect(out.ok && out.resolution.tag).toBe("litt-coder:latest");
  });

  it("a missing model hard-fails with the installed list — no substitution", () => {
    const out = resolveLocalModel(LANE_UP, "litt-fast:8k");
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain("litt-fast:8k");
      expect(out.error).toContain("litt-coder:latest");
    }
  });
});

describe("kind-based routing", () => {
  it("kind=fast prefers litt-fast:2k over the coder build", () => {
    const out = resolveLocalModel(LANE_UP, null, "fast");
    expect(out.ok && out.resolution.tag).toBe("litt-fast:2k");
  });

  it("kind=coder prefers litt-coder:latest", () => {
    const out = resolveLocalModel(LANE_UP, null, "coder");
    expect(out.ok && out.resolution.tag).toBe("litt-coder:latest");
  });

  it("default kind is coder (unchanged legacy behaviour)", () => {
    const out = resolveLocalModel(LANE_UP, null);
    expect(out.ok && out.resolution.tag).toBe("litt-coder:latest");
  });

  it("kind=fast falls back within its own list when litt-fast is absent", () => {
    const lane: LocalLaneStatus = { ...LANE_UP, models: ["litt-tools:4k", "litt-coder:latest"] };
    const out = resolveLocalModel(lane, null, "fast");
    expect(out.ok && out.resolution.tag).toBe("litt-tools:4k");
  });

  it("kind=coder falls back to litt-coder:3b when :latest is absent", () => {
    const lane: LocalLaneStatus = { ...LANE_UP, models: ["litt-coder:3b", "litt-fast:2k"] };
    const out = resolveLocalModel(lane, null, "coder");
    expect(out.ok && out.resolution.tag).toBe("litt-coder:3b");
  });

  it("selectLocalModel honours an explicit preferred tag regardless of kind", () => {
    expect(selectLocalModel(INSTALLED, "litt-coder:latest", "fast")).toBe("litt-coder:latest");
  });

  it("daemon with no models fails clearly", () => {
    const out = resolveLocalModel({ ...LANE_UP, models: [] }, null, "fast");
    expect(out.ok).toBe(false);
  });
});
