import { describe, it, expect } from "vitest";
import { WorkstreamStore } from "../ink/workstream-store.js";

describe("temp-store", () => {
  it("stores", () => {
    const s = new WorkstreamStore();
    s.addReason("hi");
    expect(s.length()).toBe(1);
  });
});
