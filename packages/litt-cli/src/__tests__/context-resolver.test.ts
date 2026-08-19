/**
 * ContextResolver tests — @mention resolution for the shell.
 * Runs against the real repo cwd (git is available).
 */

import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractMentions, resolveMention, buildPromptWithContext,
} from "../lib/context-resolver.js";

describe("context-resolver", () => {
  it("extracts @mentions from a composer value", () => {
    const tokens = extractMentions("fix @controller.ts and @git:changes please");
    expect(tokens.map((t) => t.label)).toEqual(["controller.ts", "git:changes"]);
  });

  it("@git:changes resolves to porcelain status", () => {
    const ctx = resolveMention("git:changes", process.cwd());
    expect(ctx).not.toBeNull();
    expect(ctx?.kind).toBe("git");
    expect(ctx?.content.length).toBeGreaterThan(0);
  });

  it("@git:branch resolves branch + last commit", () => {
    const ctx = resolveMention("git:branch", process.cwd());
    expect(ctx).not.toBeNull();
    expect(ctx?.content).toContain("branch:");
  });

  it("@workspace resolves to the project root", () => {
    const ctx = resolveMention("workspace", "C:\\repo");
    expect(ctx?.kind).toBe("workspace");
    expect(ctx?.content).toBe("C:\\repo");
  });

  it("@terminal:last and @error:last use the captured logs", () => {
    const terminal = resolveMention("terminal:last", "C:\\repo", { terminalLog: ["line1", "line2"], errorLog: [] });
    expect(terminal?.content).toBe("line2");
    const error = resolveMention("error:last", "C:\\repo", { terminalLog: [], errorLog: ["boom"] });
    expect(error?.content).toBe("boom");
    const missing = resolveMention("error:last", "C:\\repo", {});
    expect(missing).toBeNull();
  });

  it("resolves existing files and returns null for unknown tokens", () => {
    const dir = mkdtempSync(join(tmpdir(), "litt-ctx-"));
    try {
      writeFileSync(join(dir, "target.ts"), "export const answer = 42;\n", "utf8");
      const file = resolveMention("target.ts", dir);
      expect(file?.kind).toBe("file");
      expect(file?.content).toContain("answer = 42");
      expect(resolveMention("does-not-exist.ts", dir)).toBeNull();
      expect(resolveMention("someone@example.com", dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildPromptWithContext attaches file context and strips the mention", () => {
    const dir = mkdtempSync(join(tmpdir(), "litt-ctx-"));
    try {
      writeFileSync(join(dir, "a.ts"), "const a = 1;\n", "utf8");
      const { prompt, resolved, cleaned } = buildPromptWithContext(
        "explain @a.ts to me",
        dir,
      );
      expect(resolved).toHaveLength(1);
      expect(cleaned).toBe("explain to me");
      expect(prompt).toContain('<file path="a.ts">');
      expect(prompt).toContain("TASK: explain to me");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves unresolvable mentions in the prompt untouched", () => {
    const { prompt, resolved } = buildPromptWithContext(
      "email me at joe@example.com",
      process.cwd(),
    );
    expect(resolved).toHaveLength(0);
    expect(prompt).toBe("email me at joe@example.com");
  });

  it("returns the input unchanged when nothing resolves", () => {
    const { prompt, resolved } = buildPromptWithContext("plain question", process.cwd());
    expect(prompt).toBe("plain question");
    expect(resolved).toHaveLength(0);
  });
});
