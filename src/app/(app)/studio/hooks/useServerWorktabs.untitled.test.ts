import { describe, expect, it } from "vitest";
import { nextUntitledTitle } from "./useServerWorktabs";

describe("nextUntitledTitle", () => {
  it("starts at Untitled 1 for an empty list", () => {
    expect(nextUntitledTitle([])).toBe("Untitled 1");
  });

  it("increments past the highest existing number", () => {
    expect(nextUntitledTitle(["Untitled 1", "Untitled 2"])).toBe("Untitled 3");
  });

  it("fills the max+1 gap, ignoring non-matching titles", () => {
    expect(nextUntitledTitle(["Untitled 1", "My Project", "Untitled 3"])).toBe("Untitled 4");
  });

  it("ignores null/undefined/blank titles", () => {
    expect(nextUntitledTitle([null, undefined, "  ", "Untitled 2"])).toBe("Untitled 3");
  });

  it("does not collide after closes (closed titles still count)", () => {
    // Closing the last tab seeds a fresh task — the just-closed task's
    // title must still bump the counter so we never emit a duplicate.
    expect(nextUntitledTitle(["Untitled 1", "Untitled 2", "Untitled 3"])).toBe("Untitled 4");
  });
});
