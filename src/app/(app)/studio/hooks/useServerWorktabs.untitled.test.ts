import { describe, expect, it } from "vitest";
import { nextUntitledTitle, resolveAdoptedTaskTitle } from "./useServerWorktabs";

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

describe("resolveAdoptedTaskTitle", () => {
  it("keeps a real conversation title verbatim", () => {
    expect(resolveAdoptedTaskTitle("Dog grooming site", [])).toBe("Dog grooming site");
  });

  it("mints Untitled 1 when the conversation has no title", () => {
    expect(resolveAdoptedTaskTitle(null, [])).toBe("Untitled 1");
    expect(resolveAdoptedTaskTitle(undefined, [])).toBe("Untitled 1");
    expect(resolveAdoptedTaskTitle("   ", [])).toBe("Untitled 1");
  });

  it("yields N distinct titles when adopting N untitled conversations", () => {
    // Simulate the adoption effect: each adopted title joins the existing
    // task titles before the next adoption runs.
    const titles: Array<string | null> = ["Existing project"];
    const adopted: string[] = [];
    for (let i = 0; i < 3; i++) {
      const title = resolveAdoptedTaskTitle(null, titles);
      adopted.push(title);
      titles.push(title);
    }
    expect(adopted).toEqual(["Untitled 1", "Untitled 2", "Untitled 3"]);
    expect(new Set(adopted).size).toBe(adopted.length);
  });

  it("does not collide with previously adopted untitled tasks", () => {
    expect(resolveAdoptedTaskTitle("", ["Untitled 1", "Untitled 2"])).toBe("Untitled 3");
  });
});
