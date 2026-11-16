import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleFilesWrite, handleFilesRead } from "@/lib/litt-intelligence/tool-handlers-v2";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

/**
 * P0 — AI Build → Static Preview: verify the REAL AI file-write path.
 *
 * This test dispatches through the actual `handleFilesWrite` handler that
 * the agent loop invokes (not a mock of it), using a test transport that
 * writes to a temp directory. It proves:
 * 1. The registered handler accepts agent-style inputs and writes files.
 * 2. Path validation rejects traversal (the handler's own guard).
 * 3. Approval policy classifies files.write as auto-approvable in AUTO mode.
 * 4. Zero subprocesses are spawned during the write path.
 */

const childProcessSpies: Array<{ mockRestore(): void; mockClear(): void }> = [];

function spyOnChildProcess() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("node:child_process") as typeof import("node:child_process");
  for (const m of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    childProcessSpies.push(vi.spyOn(cp, m) as unknown as { mockRestore(): void; mockClear(): void });
  }
}

function assertZeroSubprocesses() {
  for (const spy of childProcessSpies) {
    expect(spy, `child_process.${String((spy as unknown as { getMockName?: () => string }).getMockName?.() ?? "?")} must not be called`).not.toHaveBeenCalled();
  }
}

/** Minimal WorkspaceTransport backed by a temp dir — no HTTP, no subprocess. */
function makeTestTransport(root: string): WorkspaceTransport {
  const resolve = (p: string) => {
    // Mirror the production path guard: reject traversal.
    if (p.includes("..")) throw new Error("Path traversal rejected");
    return join(root, p.replace(/^\//, ""));
  };
  return {
    projectId: "proj-test",
    userId: "user-test",
    workspaceId: "ws-test",
    workspaceRoot: root,
    fileOpsReachable: true,
    probeReachable: async () => true,
    listFiles: async () => ({ entries: [] }),
    readFile: async (path: string) => {
      const { readFileSync, statSync } = await import("node:fs");
      const full = resolve(path);
      const content = readFileSync(full, "utf-8");
      return { content, size: statSync(full).size };
    },
    readBinaryFile: async () => ({ content: "", size: 0 }),
    writeFile: async (path: string, content: string) => {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname: d } = await import("node:path");
      const full = resolve(path);
      mkdirSync(d(full), { recursive: true });
      writeFileSync(full, content, "utf-8");
      return { saved: true };
    },
    writeBinaryFile: async () => ({ saved: true }),
    deleteFile: async () => ({ deleted: true }),
    mkdir: async () => {},
    rename: async () => {},
    startPreview: async () => ({ status: "failed" as const, workspaceId: "ws-test", error: "not implemented in test" }),
    getPreviewStatus: async () => ({ status: "failed" as const, workspaceId: "ws-test", logs: [] }),
    stopPreview: async () => ({ status: "stopped" as const, workspaceId: "ws-test" }),
  } as unknown as WorkspaceTransport;
}

describe("AI file-write path (real handler dispatch)", () => {
  let root: string;
  let transport: WorkspaceTransport;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ai-write-test-"));
    transport = makeTestTransport(root);
    spyOnChildProcess();
  });

  afterEach(() => {
    for (const spy of childProcessSpies) spy.mockRestore();
    childProcessSpies.length = 0;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("dispatches files.write through the real handler and lands bytes on disk", async () => {
    const result = await handleFilesWrite(
      { path: "index.html", content: "<h1>Hello</h1>" },
      transport,
    );
    expect(result.success).toBe(true);
    expect(result.path).toBe("index.html");
    expect(existsSync(join(root, "index.html"))).toBe(true);
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe("<h1>Hello</h1>");
    assertZeroSubprocesses();
  });

  it("writes nested paths, creating directories", async () => {
    const result = await handleFilesWrite(
      { path: "assets/css/style.css", content: "body { color: red; }" },
      transport,
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(root, "assets/css/style.css"), "utf-8")).toBe("body { color: red; }");
    assertZeroSubprocesses();
  });

  it("rejects path traversal via the handler's own guard", async () => {
    const result = await handleFilesWrite(
      { path: "../evil.txt", content: "x" },
      transport,
    );
    expect(result.success).toBe(false);
    expect(existsSync(join(tmpdir(), "evil.txt"))).toBe(false);
    assertZeroSubprocesses();
  });

  it("round-trips: write then read returns identical content", async () => {
    await handleFilesWrite({ path: "app.js", content: "console.log(1);" }, transport);
    const read = await handleFilesRead({ path: "app.js" }, transport);
    expect(read.success).toBe(true);
    expect(read.content).toBe("console.log(1);");
    assertZeroSubprocesses();
  });

  it("files.write is registered in the tool registry with files:write permission", async () => {
    const mod = await import("@/lib/litt-intelligence/tool-registry");
    // The lazy handler map must contain files.write (proves registry wiring).
    const { toolRegistry, registerInternalTools } = mod;
    registerInternalTools();
    const tool = toolRegistry.get("files.write");
    expect(tool).toBeDefined();
    expect(tool?.requiredPermissions).toContain("files:write");
  });

  it("files.write is auto-approved in AUTO mode (permission engine)", async () => {
    const { PermissionEngine } = await import("@/lib/litt-intelligence/permission-engine");
    const engine = new PermissionEngine();
    const tool = {
      toolId: "files.write",
      permissionLevel: "workspace-write" as const,
      isReadOnly: false,
      isMutation: true,
      enabled: true,
      requiredCapabilities: [],
    };
    // AUTO mode: safe workspace mutations auto-approve.
    const auto = engine.check(tool, {}, "auto", []);
    expect(auto.allowed).toBe(true);
    expect(auto.requiresApproval).toBe(false);
  });

  it("files.write requires approval in ACT mode", async () => {
    const { PermissionEngine } = await import("@/lib/litt-intelligence/permission-engine");
    const engine = new PermissionEngine();
    const tool = {
      toolId: "files.write",
      permissionLevel: "workspace-write" as const,
      isReadOnly: false,
      isMutation: true,
      enabled: true,
      requiredCapabilities: [],
    };
    const act = engine.check(tool, {}, "act", []);
    expect(act.allowed).toBe(true);
    expect(act.requiresApproval).toBe(true);
  });

  it("files.write is blocked in PLAN mode (read-only only)", async () => {
    const { PermissionEngine } = await import("@/lib/litt-intelligence/permission-engine");
    const engine = new PermissionEngine();
    const tool = {
      toolId: "files.write",
      permissionLevel: "workspace-write" as const,
      isReadOnly: false,
      isMutation: true,
      enabled: true,
      requiredCapabilities: [],
    };
    const plan = engine.check(tool, {}, "plan", []);
    expect(plan.allowed).toBe(false);
  });
});

describe("handleFilesWrite — LITT-WELCOME-SCREEN scaffold exemption", () => {
  /**
   * P1 fix: the small-lane destructive-rewrite guard refused the model's
   * first files.write to index.html on every fresh project — the scaffold
   * is fully styled (sig >= 3) so the 1.5B's replacement HTML failed the
   * 40% retention floor, the approved mutation failed, and the run died
   * with "approved workspace operation failed". The scaffold's own marker
   * declares it MUST be replaced — the guard now exempts it. Real styled
   * user files still get the full guard.
   */
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "litt-ws-welcome-"));
    process.env.LITT_LOCAL_SMALL = "1";
  });
  afterEach(() => {
    delete process.env.LITT_LOCAL_SMALL;
    rmSync(root, { recursive: true, force: true });
  });

  const STYLED_SCAFFOLD = `<!-- LITT-WELCOME-SCREEN: blank-state of the LiTT builder. Not a project, not project content.
     The agent MUST replace this file with the user's real project files as soon as it starts building. -->
<!DOCTYPE html><html><head><style>
:root { color-scheme: dark; } * { box-sizing: border-box; }
body { font-family: ui-sans-serif, system-ui, sans-serif; color: #e8eef7; }
.litt-welcome { position: relative; max-width: 660px; text-align: center; }
</style></head><body><div class="litt-welcome"><h1>Welcome</h1></div></body></html>`;

  const PLAIN_USER_HTML = `<!DOCTYPE html><html><body><h1>My Site</h1><p>hello</p></body></html>`;

  it("allows a full rewrite of the welcome-screen scaffold", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "index.html"), STYLED_SCAFFOLD);
    const transport = makeTestTransport(root);
    const result = await handleFilesWrite(
      { path: "index.html", content: PLAIN_USER_HTML },
      transport,
    );
    expect(result.success).toBe(true);
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe(PLAIN_USER_HTML);
  });

  it("still refuses a destructive rewrite of a real styled user file", async () => {
    const { writeFileSync } = await import("node:fs");
    // Signature >= 3 markers so the guard engages: style-tag, class-attrs,
    // font, css-vars, semantic-layout, media-query.
    const styledUserFile = `<!DOCTYPE html><html><head><style>
:root { --accent: #0af; } body { font-family: sans-serif; }
@media (max-width: 600px) { .a { display: none; } }
</style></head><body><main class="a"><section class="b"><h1>Site</h1></section></main></body></html>`;
    writeFileSync(join(root, "index.html"), styledUserFile);
    const transport = makeTestTransport(root);
    const result = await handleFilesWrite(
      { path: "index.html", content: PLAIN_USER_HTML },
      transport,
    );
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("full-file rewrite");
    // The user's file is untouched.
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe(styledUserFile);
  });
});

describe("handleFilesWrite — preserving merge repairs destructive rewrites", () => {
  /**
   * P1 fix: the destructive-rewrite guard refused the 1.5B's modify
   * rewrites, and the refusal's apply_patch directive was a dead end —
   * the model pasted the instruction's placeholder template verbatim
   * (observed live: patches=[{search:"<existing text>"}]). Instead of
   * asking the model to repair its own rewrite, the handler now
   * mechanically re-injects the dropped external head resources
   * (stylesheet links, CDN scripts) and lands the repaired content.
   */
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "litt-ws-merge-"));
    process.env.LITT_LOCAL_SMALL = "1";
  });
  afterEach(() => {
    delete process.env.LITT_LOCAL_SMALL;
    rmSync(root, { recursive: true, force: true });
  });

  const GENERATED_SITE = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>My Website</title>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4/dist/tailwind.min.css">
<style>body { font-family: sans-serif; } @media (max-width:600px){.a{display:none}} :root{--a:#fff}</style>
</head><body class="bg-gray-100 text-gray-900"><main class="a"><h1>Welcome</h1></main></body></html>`;

  it("re-injects dropped external head refs instead of refusing", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "index.html"), GENERATED_SITE);
    const transport = makeTestTransport(root);
    // The model's rewrite: new heading + purple theme, but drops the
    // tailwind script + stylesheet link (the live refusal case).
    const rewrite = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>LiTT STUDIO VERIFIED</title><style>body{background:#333;color:#fff;font-family:'Inter',sans-serif}</style></head><body><h1>LiTT STUDIO VERIFIED</h1></body></html>`;
    const result = await handleFilesWrite({ path: "index.html", content: rewrite }, transport);
    expect(result.success).toBe(true);
    const landed = readFileSync(join(root, "index.html"), "utf-8");
    // The requested change landed...
    expect(landed).toContain("LiTT STUDIO VERIFIED");
    // ...AND the dropped external resources were preserved.
    expect(landed).toContain("@tailwindcss/browser@4");
    expect(landed).toContain("tailwind.min.css");
  });

  it("still refuses when repair is impossible (no head in rewrite)", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "index.html"), GENERATED_SITE);
    const transport = makeTestTransport(root);
    const result = await handleFilesWrite(
      { path: "index.html", content: "plain text, no html at all" },
      transport,
    );
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("full-file rewrite");
  });
});

describe("handleFilesWrite — content-preservation floor (every lane)", () => {
  /**
   * P0 nondestructive-edit fix: a follow-up "change the heading + use a
   * warm brown theme" overwrote a multi-section site with a minimal
   * heading+gallery page — every nav, section, image, and style block
   * deleted while read-back still "verified" the write. The small-lane
   * styling-signature guard could not see it (the minimal page keeps
   * style/class/font markers) and no other lane had any guard at all.
   * The floor now measures prior-content survival and refuses the
   * overwrite, steering the model to apply_patch — in EVERY lane.
   */
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "litt-ws-floor-"));
    delete process.env.LITT_LOCAL_SMALL; // floor must hold outside the small lane too
  });
  afterEach(() => {
    delete process.env.LITT_LOCAL_SMALL;
    rmSync(root, { recursive: true, force: true });
  });

  const INCIDENT_SITE = `<!doctype html><html><head><title>Ember Oak</title><style>
body{font-family:Georgia,serif;background:#f7f2ea;color:#2c2420}
nav{display:flex;gap:18px;padding:14px 24px;background:#efe6d8}
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:24px}
.gallery img{width:100%;border-radius:8px}
.menu{padding:24px;max-width:720px;margin:0 auto}
footer{padding:24px;text-align:center;background:#efe6d8}
</style></head><body>
<nav><a href="#menu">Menu</a><a href="#gallery">Gallery</a><a href="#about">About</a><a href="#contact">Contact</a></nav>
<header class="hero"><h1>EMBER OAK</h1><p>Small-batch roasted coffee</p></header>
<section class="gallery" id="gallery">
<img src="gallery-1.jpg" alt="Pour over"><img src="gallery-2.jpg" alt="Espresso shot"><img src="gallery-3.jpg" alt="Roasted beans">
</section>
<section class="menu" id="menu"><h2>Menu</h2><ul><li>Pour Over — 4</li><li>Espresso — 3</li><li>Flat White — 5</li></ul></section>
<section class="about" id="about"><h2>About</h2><p>Roasted in-house every week.</p></section>
<footer id="contact"><p>Visit us — 12 Roast Lane</p></footer>
</body></html>`;

  // The incident output: requested change applied, everything else gone —
  // but still styled, so the old guard could not see the destruction.
  const GUTTED = `<!doctype html><html><head><title>Ember Oak Roasted</title><style>
body{background:#5b3a29;color:#f5ead9;font-family:Georgia,serif}
h1{color:#d9a05b}
.gallery{display:grid;gap:16px;padding:24px}
</style></head><body>
<h1>EMBER OAK ROASTED</h1>
<div class="gallery"><img src="a.jpg"><img src="b.jpg"></div>
</body></html>`;

  it("refuses a styled rewrite that deletes most of the existing page (non-small lane)", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "index.html"), INCIDENT_SITE);
    const transport = makeTestTransport(root);
    const result = await handleFilesWrite({ path: "index.html", content: GUTTED }, transport);
    expect(result.success).toBe(false);
    // Truthful + actionable: names the file, the loss, and the patch path.
    expect(String(result.error)).toContain("index.html");
    expect(String(result.error)).toContain("existing content");
    expect(String(result.error)).toContain("apply_patch");
    // The file on disk is untouched — rejection stays a rejection.
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe(INCIDENT_SITE);
  });

  it("still refuses in the small lane when styling markers survive the gutting", async () => {
    process.env.LITT_LOCAL_SMALL = "1";
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "index.html"), INCIDENT_SITE);
    const transport = makeTestTransport(root);
    const result = await handleFilesWrite({ path: "index.html", content: GUTTED }, transport);
    expect(result.success).toBe(false);
    expect(readFileSync(join(root, "index.html"), "utf-8")).toBe(INCIDENT_SITE);
  });

  it("lands a rewrite that keeps the existing content (heading + theme only)", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "index.html"), INCIDENT_SITE);
    const transport = makeTestTransport(root);
    const preserving = INCIDENT_SITE
      .replace("<h1>EMBER OAK</h1>", "<h1>EMBER OAK ROASTED</h1>")
      .replace("background:#f7f2ea", "background:#5b3a29");
    const result = await handleFilesWrite({ path: "index.html", content: preserving }, transport);
    expect(result.success).toBe(true);
    const landed = readFileSync(join(root, "index.html"), "utf-8");
    expect(landed).toContain("EMBER OAK ROASTED");
    for (const marker of ["<nav", "<section", "gallery-3.jpg", "<footer", "Roast Lane"]) {
      expect(landed).toContain(marker);
    }
  });
});
