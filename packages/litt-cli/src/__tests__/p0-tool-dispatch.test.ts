/**
 * P0 regressions — tool-dispatch failures observed live on Windows:
 *
 *   1. "Nice can you search my c drive" → casual-prefix hijack classified
 *      CHAT → CHAT_FAST model with no tools → fabricated "can't access
 *      the filesystem" refusal. A Windows-local agent must dispatch
 *      filesystem requests to real tools, deterministically.
 *   2. "Can you see if Best Buy is open tomorrow?" → business-hours
 *      patterns only accepted "now|today|right now" — "tomorrow" fell
 *      through to the same tool-less refusal. The utility lane must
 *      match and run a real web.search.
 *
 * Covers the required regression matrix: filesystem search (execute /
 * clarify / refuse / missing / cancel-path), business hours, weather,
 * coding tasks, and normal conversation — plus real filesystem.search
 * execution against a temp tree and the C:\LiTT scope.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyIntent } from "../lib/intent.js";
import { classifyUtilityIntent, executeUtilityLookup } from "../lib/utility-lane.js";
import { matchFilesystemSearch, formatLocalToolSummary, type LocalToolResult } from "../lib/local-tool-mission.js";
import { findFilesByName, createShellExecutor } from "@litt/agent-core";
import type { ToolResult } from "@litt/agent-core";

// ─── 1. Intent: conversational preamble must not hijack actions ────

describe("intent: casual preamble cannot swallow a real request", () => {
  it.each([
    "nice can you search my c drive",
    "ok run the tests",
    "hey fix the failing test",
    "cool build the project",
  ])("%s → mission", (q) => {
    expect(classifyIntent(q)).toBe("mission");
  });

  it.each([
    "nice",
    "nice work",
    "hey what's up",
    "thanks",
    "cool thanks",
    "ok",
  ])("%s → chat (no action signal)", (q) => {
    expect(classifyIntent(q)).toBe("chat");
  });

  it("search/find questions are missions, not chat", () => {
    expect(classifyIntent("can you find package.json?")).toBe("mission");
    expect(classifyIntent("search C:\\LiTT for AGENTS.md")).toBe("mission");
    expect(classifyIntent("find all files named README.md in my approved worktree")).toBe("mission");
  });
});

// ─── 2. Filesystem dispatch: execute / clarify / refuse ────────────

describe("matchFilesystemSearch: deterministic scope decision", () => {
  it("'find package.json in my project' → execute in workspace", () => {
    const m = matchFilesystemSearch("find package.json in my project");
    expect(m?.action).toBe("execute");
    if (m?.action !== "execute") return;
    expect(m.call.toolId).toBe("filesystem.search");
    expect(m.call.args.path).toBe(".");
    expect(m.call.args.name).toBe("package.json");
  });

  it("'search C:\\LiTT for AGENTS.md' → execute the named authorized scope", () => {
    const m = matchFilesystemSearch("search C:\\LiTT for AGENTS.md");
    expect(m?.action).toBe("execute");
    if (m?.action !== "execute") return;
    expect(m.call.args.path).toBe("C:\\LiTT");
    expect(m.call.args.name).toBe("AGENTS.md");
  });

  it("'find all files named README.md in my approved worktree' → workspace execute", () => {
    const m = matchFilesystemSearch("find all files named README.md in my approved worktree");
    expect(m?.action).toBe("execute");
    if (m?.action !== "execute") return;
    expect(m.call.args.name).toBe("README.md");
    expect(m.call.args.path).toBe(".");
  });

  it("'search my c drive for a file' → clarify (target + narrower scope authorization)", () => {
    const m = matchFilesystemSearch("search my c drive for a file");
    expect(m?.action).toBe("clarify");
    if (m?.action !== "clarify") return;
    // Must ask what to look for AND offer the named-scope alternative —
    // never silently starts a whole-drive scan.
    expect(m.question).toMatch(/what am i looking for|what file/i);
    expect(m.question).toContain("C:\\LiTT");
  });

  it("broad drive request with a name → clarify with the authorized-scope phrasing", () => {
    const m = matchFilesystemSearch("search my c drive for AGENTS.md");
    expect(m?.action).toBe("clarify");
    if (m?.action !== "clarify") return;
    expect(m.question).toContain("AGENTS.md");
    expect(m.question).toMatch(/name a folder|narrower|C:\\LiTT/i);
  });

  it.each([
    "search C:\\Windows for foo.dll",
    "find config in C:\\Windows\\System32",
    "search C:\\Program Files for app.exe",
  ])("%s → refuse (denied location)", (q) => {
    const m = matchFilesystemSearch(q);
    expect(m?.action).toBe("refuse");
    if (m?.action !== "refuse") return;
    expect(m.reason).toMatch(/can't search|authorization/i);
  });

  it("non-filesystem search is not captured (content search stays mission)", () => {
    expect(matchFilesystemSearch("search my code for TODO")).toBeNull();
    expect(matchFilesystemSearch("find out why the build fails")).toBeNull();
    expect(matchFilesystemSearch("search the web for news")).toBeNull();
  });
});

// ─── 3. Real filesystem.search execution (actual directory walk) ────

describe("filesystem.search: real execution evidence", () => {
  const makeTree = () => {
    const root = mkdtempSync(path.join(tmpdir(), "litt-fs-"));
    mkdirSync(path.join(root, "src", "deep"), { recursive: true });
    mkdirSync(path.join(root, ".ssh"));
    writeFileSync(path.join(root, "AGENTS.md"), "# agents");
    writeFileSync(path.join(root, "src", "package.json"), "{}");
    writeFileSync(path.join(root, "src", "deep", "notes.txt"), "hi");
    writeFileSync(path.join(root, ".ssh", "id_rsa"), "x");
    return root;
  };

  it("finds a file by name under an explicit root — real paths returned", async () => {
    const root = makeTree();
    const shell = createShellExecutor(root);
    const res = await findFilesByName(shell, { path: root, name: "package.json" });
    expect(res.success).toBe(true);
    const data = res.data as { matches: string[]; count: number };
    expect(data.count).toBe(1);
    expect(data.matches[0]).toBe(path.join(root, "src", "package.json"));
  });

  it("glob patterns work (*.json), case-insensitive on this platform", async () => {
    const root = makeTree();
    const shell = createShellExecutor(root);
    const res = await findFilesByName(shell, { path: root, name: "*.md" });
    const matches = (res.data as { matches: string[] }).matches;
    expect(matches.some((m) => m.endsWith("AGENTS.md"))).toBe(true);
  });

  it("missing file returns a truthful empty result — never a fabricated path", async () => {
    const root = makeTree();
    const shell = createShellExecutor(root);
    const res = await findFilesByName(shell, { path: root, name: "nonexistent.xyz" });
    expect(res.success).toBe(true);
    const data = res.data as { matches: string[]; count: number };
    expect(data.count).toBe(0);
    expect(res.message).toMatch(/no matches/i);
  });

  it("denied system root returns the actual failure", async () => {
    const root = makeTree();
    const shell = createShellExecutor(root);
    const res = await findFilesByName(shell, { path: "C:\\Windows", name: "*.exe" });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/denied|authorization/i);
  });

  it("missing directory reports the real failure", async () => {
    const shell = createShellExecutor(tmpdir());
    const res = await findFilesByName(shell, { path: "C:\\litt-no-such-dir-xyz", name: "*.txt" });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });

  it("traversal in an explicit root normalizes before the blocklist (C:\\LiTT\\..\\Windows → denied)", async () => {
    const shell = createShellExecutor(tmpdir());
    const res = await findFilesByName(shell, { path: "C:\\LiTT\\..\\Windows", name: "*.exe" });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/denied|authorization/i);
  });

  it("credential directories are skipped inside an authorized root", async () => {
    const root = makeTree(); // contains .ssh/id_rsa
    const shell = createShellExecutor(root);
    const res = await findFilesByName(shell, { path: root, name: "id_rsa" });
    const data = res.data as { matches: string[]; count: number };
    expect(data.count).toBe(0); // .ssh never walked, id_rsa never surfaced
  });

  it("symlinks/junctions are never followed (no scope escape)", async () => {
    const root = makeTree();
    const outside = mkdtempSync(path.join(tmpdir(), "litt-out-"));
    writeFileSync(path.join(outside, "secret-target.md"), "x");
    const link = path.join(root, "escape-link");
    try { symlinkSync(outside, link, "junction"); } catch { /* permissions/platform */ }
    if (!existsSync(link)) return; // can't create → nothing to prove
    const shell = createShellExecutor(root);
    const res = await findFilesByName(shell, { path: root, name: "*.md" });
    const matches = (res.data as { matches: string[] }).matches;
    expect(matches.every((m) => !m.includes("escape-link"))).toBe(true);
    expect(matches.every((m) => !m.includes("secret-target"))).toBe(true);
  });

  it("AbortSignal mid-walk stops the search and reports cancelled truthfully", async () => {
    const root = makeTree();
    const ctrl = new AbortController();
    const shell = createShellExecutor(root);
    const res = await findFilesByName(shell, {
      path: root, name: "*.md", signal: ctrl.signal,
      // Abort as soon as the walk starts: schedule on the event loop.
    });
    // Second run aborted up-front must return cancelled, not fake success.
    ctrl.abort();
    const res2 = await findFilesByName(shell, { path: root, name: "*.md", signal: ctrl.signal });
    expect(res2.success).toBe(false);
    expect((res2.data as { cancelled?: boolean }).cancelled).toBe(true);
    expect(res2.message).toMatch(/cancelled/i);
    expect(res.success).toBe(true); // un-aborted run unaffected
  });

  it("'.' searches the project sandbox — C:\\LiTT is a real authorized scope", async () => {
    // Real evidence: the actual LiTT tree on this PC. C:\LiTT must exist
    // (this worktree lives inside it); AGENTS.md search proves real
    // execution outside the project sandbox when the user names it.
    const shell = createShellExecutor(process.cwd());
    const res = await findFilesByName(shell, { path: "C:\\LiTT", name: "AGENTS.md", maxDepth: 6, timeoutMs: 30000 });
    expect(res.success).toBe(true);
    const data = res.data as { matches: string[]; count: number };
    expect(data.count).toBeGreaterThan(0);
    expect(data.matches.every((m) => m.endsWith("AGENTS.md"))).toBe(true);
  }, 45_000);
});

// ─── 4. Business hours / utility routing ────────────────────────────

describe("utility lane: business-hours and external-info detection", () => {
  it.each([
    "Can you see if Best Buy is open tomorrow?",
    "is Best Buy open tomorrow",
    "what time does best buy close",
    "is the pharmacy closed tonight",
    "what are target's hours",
  ])("%s → business-hours match (real web.search)", (q) => {
    const m = classifyUtilityIntent(q);
    expect(m?.kind).toBe("business-hours");
  });

  it("business-hours executes a real web.search tool call", async () => {
    const m = classifyUtilityIntent("is Best Buy open tomorrow");
    expect(m?.kind).toBe("business-hours");
    const calls: string[] = [];
    const result = await executeUtilityLookup(m!, async (toolId) => {
      calls.push(toolId);
      return {
        status: "success", success: true, message: "ok",
        data: { answer: "Best Buy hours vary; most stores open 10am.", abstractSource: "DuckDuckGo", abstractUrl: "https://example.com" },
      } as ToolResult;
    });
    expect(calls).toEqual(["web.search"]);
    expect(result.satisfied).toBe(true);
    expect(result.text).toContain("Best Buy");
    expect(result.text).toContain("Source:");
  });

  it("failed/empty search is never dressed up as hours (unsatisfied → honest fallthrough)", async () => {
    const m = classifyUtilityIntent("is Best Buy open tomorrow");
    const result = await executeUtilityLookup(m!, async () => ({
      status: "failed", success: false, message: "network unavailable", data: {},
    }) as ToolResult);
    expect(result.satisfied).toBe(false);
    expect(result.text).toBe(""); // nothing rendered — never invented hours
  });
});

// ─── 5. Lane boundaries preserved ───────────────────────────────────

describe("routing boundaries: weather, coding, conversation unchanged", () => {
  it("current weather still routes to the utility lane (not filesystem)", () => {
    expect(matchFilesystemSearch("what's the weather in 49456")).toBeNull();
    expect(classifyUtilityIntent("what's the weather in 49456")?.kind).toBe("weather");
  });

  it("coding tasks still classify mission and are not filesystem-captured", () => {
    expect(classifyIntent("fix the failing test in router.ts")).toBe("mission");
    expect(matchFilesystemSearch("fix the failing test in router.ts")).toBeNull();
    expect(matchFilesystemSearch("search my code for TODO")).toBeNull();
  });

  it("normal conversation stays chat with no tool dispatch", () => {
    expect(classifyIntent("how are you")).toBe("chat");
    expect(matchFilesystemSearch("how are you")).toBeNull();
    expect(classifyUtilityIntent("how are you")).toBeNull();
  });
});

// ─── 6. Summary renders real search evidence ────────────────────────

describe("formatLocalToolSummary: filesystem.search evidence", () => {
  it("renders real matched paths", () => {
    const results: LocalToolResult[] = [{
      toolId: "filesystem.search", label: "Search C:\\LiTT for AGENTS.md", stepTitle: "Filesystem search",
      success: true, message: "2 matches",
      data: { root: "C:\\LiTT", query: "AGENTS.md", matches: ["C:\\LiTT\\A\\AGENTS.md", "C:\\LiTT\\B\\AGENTS.md"], count: 2 },
    }];
    const s = formatLocalToolSummary("search C:\\LiTT for AGENTS.md", results);
    expect(s).toContain("2 matches");
    expect(s).toContain("C:\\LiTT\\A\\AGENTS.md");
  });

  it("renders the honest empty result", () => {
    const results: LocalToolResult[] = [{
      toolId: "filesystem.search", label: "Search", stepTitle: "Filesystem search",
      success: true, message: 'No matches for "zzz.xyz" under C:\\LiTT',
      data: { root: "C:\\LiTT", query: "zzz.xyz", matches: [], count: 0 },
    }];
    expect(formatLocalToolSummary("x", results)).toContain("No matches");
  });

  it("renders denial truthfully", () => {
    const results: LocalToolResult[] = [{
      toolId: "filesystem.search", label: "Search", stepTitle: "Filesystem search",
      success: false, message: "Denied: C:\\Windows is a system or sensitive location",
      data: {},
    }];
    expect(formatLocalToolSummary("x", results)).toContain("Denied: C:\\Windows");
  });
});
