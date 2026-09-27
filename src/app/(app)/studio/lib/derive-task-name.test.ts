import { describe, expect, it } from "vitest";
import { deriveTaskName, UNTITLED_TASK_PATTERN } from "./derive-task-name";

describe("deriveTaskName", () => {
  it("trims and collapses whitespace", () => {
    expect(deriveTaskName("  Build me\n a   landing page  ")).toBe("Build me a landing page");
  });

  it("strips a leading slash command", () => {
    expect(deriveTaskName("/build me a landing page")).toBe("me a landing page");
  });

  it("keeps the prompt when the slash command is the whole message", () => {
    expect(deriveTaskName("/clear")).toBe("/clear");
  });

  it("strips trailing punctuation", () => {
    expect(deriveTaskName("Make the hero bigger!")).toBe("Make the hero bigger");
    expect(deriveTaskName("Add a contact form…")).toBe("Add a contact form");
  });

  it("truncates long prompts at a word boundary with an ellipsis", () => {
    const name = deriveTaskName("Build me a beautiful landing page for my landscaping business with a hero section and testimonials");
    expect(name).not.toBeNull();
    expect(name!.length).toBeLessThanOrEqual(49);
    expect(name!.endsWith("…")).toBe(true);
    expect(name).toBe("Build me a beautiful landing page for my…");
  });

  it("returns null for empty or meaningless prompts", () => {
    expect(deriveTaskName("")).toBeNull();
    expect(deriveTaskName("   ")).toBeNull();
    expect(deriveTaskName("!!!")).toBeNull();
  });

  it("matches only auto-generated untitled titles", () => {
    expect(UNTITLED_TASK_PATTERN.test("Untitled 3")).toBe(true);
    expect(UNTITLED_TASK_PATTERN.test("untitled 12")).toBe(true);
    expect(UNTITLED_TASK_PATTERN.test("My project")).toBe(false);
    expect(UNTITLED_TASK_PATTERN.test("Untitled")).toBe(false);
  });
});
