import { describe, expect, it } from "vitest";
import { displayWorktabTitle, isPlaceholderTaskTitle, nextUntitledTitle, resolveAdoptedTaskTitle } from "./useServerWorktabs";

describe("placeholder worktab identity", () => {
  it("does not expose implementation-generated tab names", () => {
    expect(isPlaceholderTaskTitle("Untitled 2")).toBe(true);
    expect(isPlaceholderTaskTitle("Current work")).toBe(true);
    expect(isPlaceholderTaskTitle("New task")).toBe(true);
    expect(isPlaceholderTaskTitle("Launch experience")).toBe(false);
    expect(displayWorktabTitle("Untitled 2", "Acceptance project")).toBe("Acceptance project");
    expect(displayWorktabTitle("Launch experience", "Acceptance project")).toBe("Launch experience");
  });
});

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

  it("uses a truthful first-run label when the conversation has no title", () => {
    expect(resolveAdoptedTaskTitle(null, [])).toBe("New conversation");
    expect(resolveAdoptedTaskTitle(undefined, [])).toBe("New conversation");
    expect(resolveAdoptedTaskTitle("   ", [])).toBe("New conversation");
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
    expect(adopted).toEqual(["New conversation", "New conversation", "New conversation"]);
  });

  it("does not manufacture numbered Untitled tabs for an untitled conversation", () => {
    expect(resolveAdoptedTaskTitle("", ["Untitled 1", "Untitled 2"])).toBe("New conversation");
  });
});
