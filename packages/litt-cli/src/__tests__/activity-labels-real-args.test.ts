/**
 * Activity labels must name the real file / command.
 *
 * Bug (2026-10-18, live cockpit): rows read "Inspecting", "Inspecting 4
 * files", "Run (2)". The agent loop emits tool events as
 * { tool, toolId, inputs: { path | command | args } } but the label code
 * looked for path/command at the TOP level, so every row fell back to a
 * generic label and the operator could not see what LiTT was doing.
 */

import { describe, it, expect } from "vitest";
import { humanizeToolLabel, toolKind } from "../ink/workstream-normalizer.js";

describe("humanizeToolLabel reads the agent loop's nested inputs", () => {
  it("read_file shows the path", () => {
    expect(humanizeToolLabel("read_file", { tool: "read_file", toolId: "project.read_file", inputs: { path: "src/math.js" } }))
      .toContain("src/math.js");
  });

  it("list_files shows the directory", () => {
    expect(humanizeToolLabel("list_files", { inputs: { path: "test" } })).toContain("test");
  });

  it("edit_file and write_file show the path", () => {
    expect(humanizeToolLabel("edit_file", { inputs: { path: "test/math.test.js", old_string: "a", new_string: "b" } }))
      .toContain("test/math.test.js");
    expect(humanizeToolLabel("write_file", { inputs: { path: "src/new.js", content: "x" } })).toContain("src/new.js");
  });

  it("run shows the command and its arguments", () => {
    const label = humanizeToolLabel("run", { inputs: { command: "git", args: ["status", "--short"] } });
    expect(label).toContain("git");
    expect(label).toContain("status");
    expect(toolKind("run")).toBe("command");
  });

  it("top-level args still work (other event sources)", () => {
    expect(humanizeToolLabel("read_file", { path: "README.md" })).toContain("README.md");
  });

  it("never echoes file CONTENT into the label", () => {
    const label = humanizeToolLabel("write_file", { inputs: { path: "a.env.example", content: "API_KEY=sk-live-secret" } });
    expect(label).not.toContain("sk-live-secret");
  });
});
