import { describe, it, expect } from "vitest";
import { WorkstreamStore } from "../ink/workstream-store.js";
import { estimateWorkstreamRows, WorkstreamView } from "../ink/workstream.js";

describe("temp-jsx", () => {
  it("imports workstream.tsx", () => {
    const s = new WorkstreamStore();
    expect(estimateWorkstreamRows(s.snapshot())).toBe(0);
    expect(typeof WorkstreamView).toBe("function");
  });
});
