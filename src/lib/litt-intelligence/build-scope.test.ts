import { describe, it, expect } from "vitest";
import {
  buildScopeApprovalReason,
  buildScopeCoversTool,
  isAlwaysSeparateApprovalTool,
  isBuildScopeTool,
} from "./build-scope";
import { setDelegateToolId } from "./tool-delegates";

/**
 * ACC-07 Item 3 — Larry's ruling (2026-11-25): one approval covers
 * the entire scoped build (code, images, file generation); publishing,
 * destructive operations, sensitive changes, and expanded scope still
 * require their own approval. These tests pin the line the loop's
 * gates consult.
 */
describe("build-scope — the scope line", () => {
  it("covers the build's content work: files, pages, images, media", () => {
    for (const toolId of [
      "files.write",
      "files.create",
      "files.mkdir",
      "files.rename",
      "files.move",
      "files.patch",
      "apply_patch",
      "site.compose",
      "site.patch",
      "site.html",
      "site.webmanifest",
      "image.stock",
      "image.generate",
      "image.upscale",
      "video.generate",
      "audio.generate",
      "audio.sfx",
      "audio.tts",
    ]) {
      expect(isBuildScopeTool(toolId), toolId).toBe(true);
      expect(buildScopeCoversTool(true, toolId), toolId).toBe(true);
    }
  });

  it("never covers publishing, destructive, or sensitive actions", () => {
    for (const toolId of [
      "project.deploy",
      "deploy.execute",
      "files.delete",
      "git.push",
      "git.force_push",
      "git.reset_hard",
      "git.rebase",
    ]) {
      expect(isAlwaysSeparateApprovalTool(toolId), toolId).toBe(true);
      expect(isBuildScopeTool(toolId), toolId).toBe(false);
      expect(buildScopeCoversTool(true, toolId), toolId).toBe(false);
    }
  });

  it("covers nothing without a granted scope", () => {
    expect(buildScopeCoversTool(false, "files.write")).toBe(false);
    expect(buildScopeCoversTool(false, "image.stock")).toBe(false);
  });

  it("never covers tools outside the build set, scope or not", () => {
    for (const toolId of ["terminal.execute", "git.commit", "browser.click", "project.scan", "files.read"]) {
      expect(buildScopeCoversTool(true, toolId), toolId).toBe(false);
    }
  });

  it("resolves delegate aliases to their canonical tool before deciding", () => {
    // Station actions register their canonical tool at runtime; an
    // alias must never carry a different scope answer than the tool
    // it actually executes.
    setDelegateToolId("station.writeFile", "files.write");
    expect(isBuildScopeTool("station.writeFile")).toBe(true);
    expect(buildScopeCoversTool(true, "station.writeFile")).toBe(true);
    setDelegateToolId("station.deploy", "project.deploy");
    expect(isBuildScopeTool("station.deploy")).toBe(false);
    expect(buildScopeCoversTool(true, "station.deploy")).toBe(false);
  });

  it("the approval card text displays what the approval authorizes — and excludes", () => {
    const reason = buildScopeApprovalReason("files.write");
    expect(reason).toContain("covers the whole build");
    expect(reason).toContain("writing and editing this project's files");
    expect(reason).toContain("images and media the build needs");
    expect(reason).toContain("will not be asked again for those steps");
    expect(reason).toContain("does NOT cover publishing or deploying");
    expect(reason).toContain("deleting files");
    expect(reason).toContain("those will still ask for their own approval");
  });
});
