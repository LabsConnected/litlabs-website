/**
 * Local lane model preference — which installed Ollama model serves when the
 * operator has not named one.
 *
 * litt-coder:quick (the operator's fast build) leads; litt-coder:latest
 * (Qwen3 4B, tool-capable) outranks litt-coder:3b (Qwen2.5 3B), which made
 * zero tool calls in a real Act-mode run on 2026-10-18.
 */

import { describe, it, expect } from "vitest";
import { selectLocalModel } from "../lib/local-lane.js";

describe("selectLocalModel preference order", () => {
  it("prefers litt-coder:quick when installed", () => {
    expect(selectLocalModel(["qwen3:4b", "litt-coder:latest", "litt-coder:quick", "litt-coder:fast"])).toBe("litt-coder:quick");
  });

  it("falls back to litt-coder:fast before the other builds", () => {
    expect(selectLocalModel(["litt-coder:3b", "litt-coder:fast", "litt-coder:latest"])).toBe("litt-coder:fast");
  });

  it("prefers the tool-capable litt-coder:latest over litt-coder:3b", () => {
    expect(selectLocalModel(["litt-coder:3b", "qwen2.5-coder:3b", "litt-coder:latest"])).toBe("litt-coder:latest");
  });

  it("an explicitly preferred installed model always wins", () => {
    expect(selectLocalModel(["litt-coder:quick", "qwen3:4b"], "qwen3:4b")).toBe("qwen3:4b");
  });

  it("returns the first installed model when no preference matches, and null when none", () => {
    expect(selectLocalModel(["phi3:mini"])).toBe("phi3:mini");
    expect(selectLocalModel([])).toBeNull();
  });
});
