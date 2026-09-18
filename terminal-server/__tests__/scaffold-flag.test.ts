/**
 * Starter-scaffolding flag (brief §7) — regression tests.
 *
 * The defect this slice fixes: a new project's "Welcome to LiTT" page is
 * temporary scaffolding, but nothing machine-readable marked it as such.
 * Builds layered onto it (or the agent merged with it) because the only
 * signals were prompt text and a dead HTML comment nobody consumed.
 *
 * These tests exercise the real filesystem and real git:
 * - the `scaffolded` manifest is written at project creation (per template)
 * - a build write to a scaffold file replaces untouched scaffolding
 *   wholesale, after a git undo checkpoint
 * - user-edited content is NEVER deleted (hash mismatch ⇒ preserved)
 * - the first write outside scaffolding consumes the flag and deletes nothing
 * - the undo checkpoint restores the pre-build state (brief §15 "Undo")
 * - "Refresh mid-run": the flag lives on disk, so a second write is a no-op
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { simpleGit } from "simple-git";

import { isIgnoredDir } from "../workspace/WorkspaceSecurity";

import {
  writeScaffoldManifest,
  readScaffoldManifest,
  isScaffolded,
  clearScaffoldManifest,
  replaceScaffoldingForWrite,
  normalizeScaffoldPath,
  scaffoldManifestPath,
  sha256Hex,
  SCAFFOLD_DIR_NAME,
} from "../workspace/scaffold";
import {
  WELCOME_SCREEN_MARKER,
  buildWelcomeHtml,
} from "../workspace/welcome-screen";
import { writeTemplateFiles } from "../workspace/WorkspaceManager";

const GIT_TIMEOUT_MS = 30_000;
let ROOT: string;

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "litt-scaffold-"));
});

afterEach(() => {
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // Windows can hold a git handle briefly; the temp dir is disposable.
  }
});

/** Seed a git repo the way prepareManagedWorkspace leaves it: template files committed. */
async function seedGitRepo(root: string): Promise<string> {
  const git = simpleGit(root);
  await git.init();
  await git.addConfig("user.name", "LiTT Studio");
  await git.addConfig("user.email", "studio@litt.dev");
  try {
    await git.raw(["checkout", "-B", "main"]);
  } catch {
    // Older git without -B on an unborn branch — the commit below still works.
  }
  await git.add("-A");
  await git.commit("Initial commit — LiTT managed project");
  return (await git.revparse("HEAD")).trim();
}

describe("scaffold manifest lifecycle", () => {
  it("writes a manifest at creation and reads it back", () => {
    writeFileSync(join(ROOT, "index.html"), buildWelcomeHtml(), "utf-8");
    const manifest = writeScaffoldManifest(ROOT, "blank-static", ["index.html"]);

    expect(manifest).not.toBeNull();
    expect(isScaffolded(ROOT)).toBe(true);

    const read = readScaffoldManifest(ROOT)!;
    expect(read.version).toBe(1);
    expect(read.scaffolded).toBe(true);
    expect(read.marker).toBe(WELCOME_SCREEN_MARKER);
    expect(read.templateId).toBe("blank-static");
    expect(read.scaffoldFiles).toEqual(["index.html"]);
    // The hash is taken from the real seeded bytes — the "untouched" proof.
    expect(read.hashes["index.html"]).toBe(
      sha256Hex(readFileSync(join(ROOT, "index.html"))),
    );
    expect(existsSync(scaffoldManifestPath(ROOT))).toBe(true);
  });

  it("seeds the flag per template via writeTemplateFiles", () => {
    const cases: Array<{ template: string; files: string[] }> = [
      { template: "blank-static", files: ["index.html"] },
      { template: "nextjs", files: ["app/page.tsx"] },
      { template: "react-vite", files: ["src/App.tsx"] },
    ];
    for (const { template, files } of cases) {
      const dir = mkdtempSync(join(tmpdir(), "litt-scaffold-tpl-"));
      try {
        writeTemplateFiles(dir, template);
        expect(isScaffolded(dir)).toBe(true);
        const manifest = readScaffoldManifest(dir)!;
        expect(manifest.templateId).toBe(template);
        expect(manifest.scaffoldFiles).toEqual(files);
        for (const f of files) {
          expect(existsSync(join(dir, ...f.split("/")))).toBe(true);
          // Hash matches the actual seeded bytes on disk.
          expect(manifest.hashes[f]).toBe(
            sha256Hex(readFileSync(join(dir, ...f.split("/")))),
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("does not flag the empty-static template (nothing seeded)", () => {
    writeTemplateFiles(ROOT, "empty-static");
    expect(isScaffolded(ROOT)).toBe(false);
    expect(existsSync(join(ROOT, SCAFFOLD_DIR_NAME))).toBe(false);
  });

  it("clearScaffoldManifest consumes the flag and tidies the dir", () => {
    writeFileSync(join(ROOT, "index.html"), buildWelcomeHtml(), "utf-8");
    writeScaffoldManifest(ROOT, "blank-static", ["index.html"]);
    expect(isScaffolded(ROOT)).toBe(true);

    clearScaffoldManifest(ROOT);

    expect(isScaffolded(ROOT)).toBe(false);
    expect(existsSync(scaffoldManifestPath(ROOT))).toBe(false);
    // Idempotent — clearing twice is fine.
    clearScaffoldManifest(ROOT);
  });

  it("a manifest with a mismatched marker is treated as not-scaffolding", () => {
    writeFileSync(join(ROOT, "index.html"), buildWelcomeHtml(), "utf-8");
    writeScaffoldManifest(ROOT, "blank-static", ["index.html"]);

    // Tamper with the marker (stale/foreign manifest).
    const raw = JSON.parse(readFileSync(scaffoldManifestPath(ROOT), "utf-8"));
    raw.marker = "SOMETHING-ELSE";
    writeFileSync(scaffoldManifestPath(ROOT), JSON.stringify(raw), "utf-8");

    // Safe default: never delete on a manifest we don't fully trust.
    expect(isScaffolded(ROOT)).toBe(false);
  });

  it("a corrupt manifest is treated as not-scaffolding", () => {
    writeFileSync(join(ROOT, "index.html"), "<html></html>", "utf-8");
    mkdirSync(join(ROOT, SCAFFOLD_DIR_NAME), { recursive: true });
    writeFileSync(scaffoldManifestPath(ROOT), "{not json", "utf-8");

    expect(isScaffolded(ROOT)).toBe(false);
  });

  it("normalizes write paths for comparison", () => {
    expect(normalizeScaffoldPath("./index.html")).toBe("index.html");
    expect(normalizeScaffoldPath("/index.html")).toBe("index.html");
    expect(normalizeScaffoldPath("app\\page.tsx")).toBe("app/page.tsx");
    expect(normalizeScaffoldPath("app/page.tsx")).toBe("app/page.tsx");
  });
});

describe("replaceScaffoldingForWrite", { timeout: GIT_TIMEOUT_MS }, () => {
  it("replaces untouched scaffolding wholesale on a build write", async () => {
    writeTemplateFiles(ROOT, "blank-static");
    const initialSha = await seedGitRepo(ROOT);

    const result = await replaceScaffoldingForWrite(ROOT, "index.html");

    expect(result.acted).toBe(true);
    expect(result.flagCleared).toBe(true);
    expect(result.reason).toBe("scaffold-file-overwrite");
    // Untouched scaffold file removed wholesale…
    expect(existsSync(join(ROOT, "index.html"))).toBe(false);
    expect(result.removedFiles).toEqual(["index.html"]);
    // …flag consumed…
    expect(isScaffolded(ROOT)).toBe(false);
    // …and a git undo checkpoint captures the pre-build state.
    expect(result.checkpoint).not.toBeNull();
    expect(result.checkpoint!.kind).toBe("git");
    expect(result.checkpoint!.ref).toMatch(/^[0-9a-f]{7,40}$/);
    // Untouched tree: the initial commit already holds the scaffolding.
    expect(result.checkpoint!.ref).toBe(initialSha);
  });

  it("never deletes user-edited scaffold content", async () => {
    writeTemplateFiles(ROOT, "blank-static");
    await seedGitRepo(ROOT);

    // The user edits the page through a path that bypassed flag-clearing:
    // bytes no longer match the seeded hash, but the flag is still set.
    writeFileSync(join(ROOT, "index.html"), "<h1>My edited page</h1>", "utf-8");

    const result = await replaceScaffoldingForWrite(ROOT, "index.html");

    expect(result.acted).toBe(true);
    expect(result.flagCleared).toBe(true);
    // The edited file is PRESERVED — never deleted for containing
    // "Welcome to LiTT".
    expect(existsSync(join(ROOT, "index.html"))).toBe(true);
    expect(readFileSync(join(ROOT, "index.html"), "utf-8")).toBe("<h1>My edited page</h1>");
    expect(result.removedFiles).toEqual([]);
    expect(result.preservedEditedFiles).toEqual(["index.html"]);
    // The checkpoint still captures the pre-replacement (edited) state.
    expect(result.checkpoint).not.toBeNull();
  });

  it("a first write outside scaffolding clears the flag and deletes nothing", async () => {
    writeTemplateFiles(ROOT, "blank-static");
    await seedGitRepo(ROOT);

    // "Add an emblem to this page": the agent saves an asset first.
    const result = await replaceScaffoldingForWrite(
      ROOT,
      "public/assets/images/neon-lightning.svg",
    );

    expect(result.acted).toBe(false);
    expect(result.flagCleared).toBe(true);
    expect(result.reason).toBe("non-scaffold-write");
    // The page is preserved — brief §7: adding to the page keeps the page.
    expect(existsSync(join(ROOT, "index.html"))).toBe(true);
    expect(readFileSync(join(ROOT, "index.html"), "utf-8")).toContain("Welcome to LiTT");
    expect(isScaffolded(ROOT)).toBe(false);
    expect(result.checkpoint).toBeNull();
  });

  it("is a no-op when the workspace was never scaffolded", async () => {
    writeFileSync(join(ROOT, "index.html"), "<h1>Real site</h1>", "utf-8");

    const result = await replaceScaffoldingForWrite(ROOT, "index.html");

    expect(result.acted).toBe(false);
    expect(result.flagCleared).toBe(false);
    expect(existsSync(join(ROOT, "index.html"))).toBe(true);
  });

  it("refresh mid-run: a second write after replacement is a no-op", async () => {
    writeTemplateFiles(ROOT, "blank-static");
    await seedGitRepo(ROOT);

    const first = await replaceScaffoldingForWrite(ROOT, "index.html");
    expect(first.acted).toBe(true);

    // The agent's actual build write lands, then a refresh/retry writes again.
    writeFileSync(join(ROOT, "index.html"), "<h1>Roofing site</h1>", "utf-8");
    const second = await replaceScaffoldingForWrite(ROOT, "index.html");

    expect(second.acted).toBe(false);
    expect(second.flagCleared).toBe(false);
    expect(readFileSync(join(ROOT, "index.html"), "utf-8")).toBe("<h1>Roofing site</h1>");
  });

  it("undo: the checkpoint restores the pre-build state", async () => {
    writeTemplateFiles(ROOT, "blank-static");
    await seedGitRepo(ROOT);

    const result = await replaceScaffoldingForWrite(ROOT, "index.html");
    expect(result.acted).toBe(true);
    expect(existsSync(join(ROOT, "index.html"))).toBe(false);

    // brief §15 "Undo": previous revision restored via the checkpoint SHA.
    const git = simpleGit(ROOT);
    await git.reset(["--hard", result.checkpoint!.ref]);

    expect(existsSync(join(ROOT, "index.html"))).toBe(true);
    expect(readFileSync(join(ROOT, "index.html"), "utf-8")).toContain("Welcome to LiTT");
    // The flag comes back with the checkpoint — undo truly restores.
    expect(isScaffolded(ROOT)).toBe(true);
  });

  it("handles a nextjs workspace: only the welcome page is scaffolding", async () => {
    writeTemplateFiles(ROOT, "nextjs");
    await seedGitRepo(ROOT);

    const result = await replaceScaffoldingForWrite(ROOT, "app/page.tsx");

    expect(result.acted).toBe(true);
    expect(result.removedFiles).toEqual(["app/page.tsx"]);
    // Real structure is not scaffolding and is never touched.
    expect(existsSync(join(ROOT, "package.json"))).toBe(true);
    expect(existsSync(join(ROOT, "app", "layout.tsx"))).toBe(true);
    expect(isScaffolded(ROOT)).toBe(false);
  });

  it("does not mistake the Studio file listing for content: .litt stays hidden", () => {
    writeTemplateFiles(ROOT, "blank-static");
    // The manifest dir exists on disk…
    expect(existsSync(join(ROOT, SCAFFOLD_DIR_NAME))).toBe(true);
    // …but it is platform state, not project content.
    expect(isIgnoredDir(SCAFFOLD_DIR_NAME)).toBe(true);
    const visible = readdirSync(ROOT).filter((e) => e !== ".git" && !isIgnoredDir(e));
    expect(visible).toEqual(["index.html"]);
  });
});
