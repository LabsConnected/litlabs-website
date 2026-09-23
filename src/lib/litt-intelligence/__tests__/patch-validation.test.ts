// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";
import { buildPatchRecoveryMessage, findTailwindImportTrap, validateApplyPatchInputs, validateFilesWriteInputs } from "../patch-validation";
import { normalizeWorkspaceRelativePath } from "../workspace-path";

/**
 * Regression tests for the pre-approval apply_patch guard (P1 patch
 * quality).
 *
 * The production defect: the model generated a patch whose search string
 * contained an unresolved placeholder (`[PERSON_NAME] · 2024 · …`). The
 * approval gate froze those inputs, so the user was asked to approve a
 * patch that could never apply — and each approve→resume→re-pause cycle
 * replayed the same dead patch.
 *
 * The guard must:
 *  - reject unresolved template tokens before they reach approval
 *  - reject search strings that literally cannot match the target file
 *  - NOT flag legitimate bracket syntax ([TODO], [0], [data-x], tuples)
 *  - produce a regeneration directive, not a user-facing rejection
 */

const FILE_CONTENT = `<footer>Ember Roast · 2024 · Handcrafted coffee.</footer>`;

function fakeTransport(content: string | null = FILE_CONTENT): WorkspaceTransport {
  return {
    workspaceId: "ws-1",
    readFile: vi.fn(async () => {
      if (content === null) throw new Error("readFile failed (404)");
      return { content, size: content.length };
    }),
  } as unknown as WorkspaceTransport;
}

describe("validateApplyPatchInputs — placeholder tokens", () => {
  it("rejects [PERSON_NAME]-style bracket placeholders in search", async () => {
    const err = await validateApplyPatchInputs(
      { path: "index.html", patches: [{ search: "<footer>[PERSON_NAME] · 2024 · Handcrafted coffee.</footer>", replace: "<footer>x</footer>" }] },
      fakeTransport(),
    );
    expect(err).toContain("[PERSON_NAME]");
    expect(err).toContain("literal text");
  });

  it("rejects [BRAND_NAME] and other SCREAMING_SNAKE bracket tokens", async () => {
    for (const token of ["[BRAND_NAME]", "[YOUR_EMAIL_HERE]", "[INSERT_TITLE_HERE]"]) {
      const err = await validateApplyPatchInputs(
        { path: "index.html", patches: [{ search: FILE_CONTENT, replace: `x ${token} y` }] },
        fakeTransport(),
      );
      expect(err).toContain(token);
    }
  });

  it("rejects {{moustache}} placeholders in either field", async () => {
    const err = await validateApplyPatchInputs(
      { path: "index.html", patches: [{ search: FILE_CONTENT, replace: "By {{company_name}}" }] },
      fakeTransport(),
    );
    expect(err).toContain("{{company_name}}");
  });

  it("rejects single-word canonical redaction tokens in replace content", async () => {
    // Canonical PII/redaction slots are single words without an underscore —
    // [EMAIL], [PHONE], [ADDRESS] — so the SCREAMING_SNAKE rule alone misses
    // them. They are enumerated explicitly so arbitrary single-word brackets
    // like [TODO]/[OK]/[WIP] stay legitimate.
    for (const token of ["[EMAIL]", "[PHONE]", "[ADDRESS]"]) {
      const err = await validateApplyPatchInputs(
        { path: "index.html", patches: [{ search: FILE_CONTENT, replace: `Contact: ${token}` }] },
        fakeTransport(),
      );
      expect(err).toContain(token);
    }
  });

  it("does NOT flag legitimate bracket syntax", async () => {
    const legit = [
      "// [TODO] tighten spacing later",
      "arr[0] = items[i];",
      "el.getAttribute('[data-hero]')",
      "type Pair = [string, number];",
      "[OK] all checks passed",
    ];
    for (const text of legit) {
      const err = await validateApplyPatchInputs(
        { path: "index.html", patches: [{ search: FILE_CONTENT, replace: text }] },
        fakeTransport(),
      );
      expect(err).toBeNull();
    }
  });
});

describe("validateApplyPatchInputs — search must exist in the file", () => {
  it("rejects a search string that cannot apply — hallucinated file content", async () => {
    const err = await validateApplyPatchInputs(
      { path: "index.html", patches: [{ search: "<footer>Something that was never in the file</footer>", replace: "<footer>new</footer>" }] },
      fakeTransport(),
    );
    expect(err).toContain("does not appear in index.html");
    expect(err).toContain("re-read");
  });

  it("accepts a patch whose search exists verbatim", async () => {
    const err = await validateApplyPatchInputs(
      { path: "index.html", patches: [{ search: "Handcrafted coffee.", replace: "Freshly roasted, delivered daily." }] },
      fakeTransport(),
    );
    expect(err).toBeNull();
  });

  it("rejects when the target file cannot be read", async () => {
    const err = await validateApplyPatchInputs(
      { path: "missing.html", patches: [{ search: "x", replace: "y" }] },
      fakeTransport(null),
    );
    expect(err).toContain("could not read missing.html");
  });

  it("rejects malformed inputs before any file read", async () => {
    const transport = fakeTransport();
    const err = await validateApplyPatchInputs({ path: "index.html", patches: [] }, transport);
    expect(err).toContain("non-empty patches[]");
    expect(transport.readFile).not.toHaveBeenCalled();
  });
});

describe("validateFilesWriteInputs — placeholder tokens in written content", () => {
  // Production defect: a full-file rewrite shipped
  // `<title>[PERSON_NAME] — Premium Coffee Roasters</title>` because the
  // model substituted a template slot for the literal brand name, and the
  // placeholder scan only guarded apply_patch — never files.write.

  it("rejects [PERSON_NAME]-style bracket placeholders in content", () => {
    const err = validateFilesWriteInputs({
      path: "index.html",
      content: "<html><title>[PERSON_NAME] — Premium Coffee Roasters</title></html>",
    });
    expect(err).toContain("[PERSON_NAME]");
    expect(err).toContain("literal text");
  });

  it("rejects {{moustache}} placeholders in content", () => {
    const err = validateFilesWriteInputs({
      path: "index.html",
      content: "<footer>By {{company_name}}</footer>",
    });
    expect(err).toContain("{{company_name}}");
  });

  it("rejects single-word canonical redaction tokens in content", () => {
    for (const token of ["[EMAIL]", "[PHONE]", "[ADDRESS]"]) {
      const err = validateFilesWriteInputs({
        path: "index.html",
        content: `<p>Contact ${token} for details</p>`,
      });
      expect(err).toContain(token);
    }
  });

  it("accepts real file content, including legitimate bracket syntax", () => {
    const legit = [
      "<title>Ember Roast — Premium Coffee Roasters</title>",
      "// [TODO] tighten spacing later\nconst a = items[0];",
      "type Pair = [string, number];",
    ];
    for (const content of legit) {
      expect(validateFilesWriteInputs({ path: "index.html", content })).toBeNull();
    }
  });

  it("rejects malformed inputs", () => {
    expect(validateFilesWriteInputs({ path: "index.html" })).toContain("string content");
    expect(validateFilesWriteInputs({ content: "x" })).toContain("target path");
    expect(validateFilesWriteInputs({})).toContain("target path");
  });
});

describe("workspace-relative paths", () => {
  it("defaults an omitted files.list path to the workspace root", () => {
    expect(normalizeWorkspaceRelativePath(undefined, { defaultToRoot: true })).toEqual({ path: "." });
  });

  it.each(["C:/workspace/index.html", "/workspace/index.html", "../index.html", "src/../../index.html"])(
    "rejects unsafe path %s",
    (value) => expect(normalizeWorkspaceRelativePath(value)).toHaveProperty("error"),
  );

  it("normalizes harmless separator and whitespace differences", () => {
    expect(normalizeWorkspaceRelativePath("  src\\pages\\home.html  ")).toEqual({ path: "src/pages/home.html" });
  });

  it("re-reads the real file and supplies safe recovery context", async () => {
    const transport = fakeTransport();
    const message = await buildPatchRecoveryMessage(
      { path: "index.html", patches: [{ search: "stale", replace: "new" }] },
      transport,
      "patch did not match",
      1,
    );
    expect(transport.readFile).toHaveBeenCalledTimes(1);
    expect(message).toContain("CURRENT FILE CONTENT (index.html)");
    expect(message).toContain("Ember Roast");
    expect(message).toContain("files.write");
  });
});

// ─── Handler-level enforcement floor ─────────────────────────────
//
// The loop's pre-approval gate is not the only route into a mutation:
// /api/litt/tools/execute calls the registry handlers directly, and a
// paused run persisted before the loop guard shipped resumes into the
// same handlers. The handlers themselves must refuse placeholder content
// so no entry point can persist it.

describe("mutation handlers — enforcement floor", () => {
  async function loadHandlers() {
    return import("../tool-handlers-v2");
  }

  function spyTransport() {
    return {
      workspaceId: "ws-1",
      writeFile: vi.fn(async () => {}),
      applyPatch: vi.fn(async () => {}),
      deleteFile: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      rename: vi.fn(async () => {}),
      gitCommit: vi.fn(async () => ({ committed: true })),
      exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    } as unknown as WorkspaceTransport & {
      writeFile: ReturnType<typeof vi.fn>;
      applyPatch: ReturnType<typeof vi.fn>;
      deleteFile: ReturnType<typeof vi.fn>;
      mkdir: ReturnType<typeof vi.fn>;
      rename: ReturnType<typeof vi.fn>;
      gitCommit: ReturnType<typeof vi.fn>;
      exec: ReturnType<typeof vi.fn>;
    };
  }

  it("files.write rejects [PERSON_NAME] content without touching the transport", async () => {
    const { handleFilesWrite } = await loadHandlers();
    const t = spyTransport();
    const res = await handleFilesWrite(
      { path: "index.html", content: "<title>[PERSON_NAME] — Premium Coffee Roasters</title>" },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("[PERSON_NAME]");
    expect(t.writeFile).not.toHaveBeenCalled();
  });

  it("files.write round-trips the literal brand name unchanged", async () => {
    const { handleFilesWrite } = await loadHandlers();
    const t = spyTransport();
    const res = await handleFilesWrite(
      { path: "index.html", content: "<title>Ember Roast — Premium Coffee Roasters</title>" },
      t,
    );
    expect(res.success).toBe(true);
    expect(t.writeFile).toHaveBeenCalledWith("index.html", "<title>Ember Roast — Premium Coffee Roasters</title>");
  });

  it("files.list rejects absolute and parent paths before transport access", async () => {
    const { handleFilesList } = await loadHandlers();
    const t = spyTransport();
    const res = await handleFilesList({ path: "C:/workspace/index.html" }, t);
    expect(res.success).toBe(false);
    expect(res.error).toContain("workspace-relative");
  });

  it("apply_patch rejects a placeholder in replace before executing", async () => {
    const { handleApplyPatch } = await loadHandlers();
    const t = spyTransport();
    const res = await handleApplyPatch(
      {
        path: "index.html",
        patches: [{ search: "<title>Ember Roast</title>", replace: "<title>[BRAND_NAME]</title>" }],
      },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("[BRAND_NAME]");
    expect(t.applyPatch).not.toHaveBeenCalled();
  });

  it("apply_patch rejects a placeholder in search", async () => {
    const { handleApplyPatch } = await loadHandlers();
    const t = spyTransport();
    const res = await handleApplyPatch(
      { path: "index.html", patches: [{ search: "[PERSON_NAME]", replace: "Ember Roast" }] },
      t,
    );
    expect(res.success).toBe(false);
    expect(t.applyPatch).not.toHaveBeenCalled();
  });

  it("files.rename rejects placeholder paths", async () => {
    const { handleFilesRename } = await loadHandlers();
    const t = spyTransport();
    const res = await handleFilesRename({ path: "a.html", newPath: "[PERSON_NAME].html" }, t);
    expect(res.success).toBe(false);
    expect(t.rename).not.toHaveBeenCalled();
  });

  it("files.mkdir and files.delete reject placeholder paths", async () => {
    const { handleFilesMkdir, handleFilesDelete } = await loadHandlers();
    const t = spyTransport();
    expect((await handleFilesMkdir({ path: "[NEW_DIR]" }, t)).success).toBe(false);
    expect((await handleFilesDelete({ path: "[EMAIL].txt" }, t)).success).toBe(false);
    expect(t.mkdir).not.toHaveBeenCalled();
    expect(t.deleteFile).not.toHaveBeenCalled();
  });

  it("git.commit rejects a placeholder message", async () => {
    const { handleGitCommit } = await loadHandlers();
    const t = spyTransport();
    const res = await handleGitCommit({ message: "Update [BRAND_NAME] landing" }, t);
    expect(res.success).toBe(false);
    expect(t.gitCommit).not.toHaveBeenCalled();
  });

  it("terminal.execute rejects a placeholder smuggled through a shell write", async () => {
    const { handleTerminalExecute } = await loadHandlers();
    const t = spyTransport();
    const res = await handleTerminalExecute(
      { command: "cat > index.html <<'EOF'\n<title>[PERSON_NAME]</title>\nEOF" },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("[PERSON_NAME]");
    expect(t.exec).not.toHaveBeenCalled();
  });
});

describe("findTailwindImportTrap — Tailwind v4 browser @import trap (P0)", () => {
  const TRAPPED = `<html><head>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">
@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");
.glass { backdrop-filter: blur(12px); }
</style></head><body><h1 class="text-3xl">Hi</h1></body></html>`;

  const BLESSED = `<html><head>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">
<style type="text/tailwindcss">
@theme { --color-glow: #a8ff2f; }
.glass { backdrop-filter: blur(12px); }
</style></head><body><h1 class="text-3xl">Hi</h1></body></html>`;

  const EXPLICIT_IMPORT = `<style type="text/tailwindcss">
@import "tailwindcss";
@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");
</style>`;

  it("rejects a files.write whose tailwindcss block has a fonts @import and no tailwindcss import", () => {
    const err = validateFilesWriteInputs({ path: "index.html", content: TRAPPED });
    expect(err).toContain("tailwindcss");
    expect(err).toContain("@import");
    expect(err).toContain("<link>");
  });

  it("accepts the blessed head pattern (fonts via <link>, no @import in the tailwind block)", () => {
    expect(validateFilesWriteInputs({ path: "index.html", content: BLESSED })).toBeNull();
  });

  it("accepts a block with an explicit @import \"tailwindcss\" alongside other imports", () => {
    expect(validateFilesWriteInputs({ path: "index.html", content: EXPLICIT_IMPORT })).toBeNull();
  });

  it("is case-insensitive on the style tag but mirrors the build's @import check", () => {
    const upper = `<STYLE TYPE="TEXT/TAILWINDCSS">@import url("https://fonts.googleapis.com/css2?family=Inter");</STYLE>`;
    expect(findTailwindImportTrap(upper)).not.toBeNull();
    const escapedUpper = `<style type="text/tailwindcss">@import "TailwindCSS";</style>`;
    expect(findTailwindImportTrap(escapedUpper)).toBeNull();
  });

  it("flags the trap even when a second clean tailwind block exists", () => {
    const mixed = `<style type="text/tailwindcss">@theme { --x: 1; }</style>` + TRAPPED;
    expect(findTailwindImportTrap(mixed)).not.toBeNull();
  });

  it("ignores @import in plain <style> blocks (not the browser build's input)", () => {
    const plain = `<style>@import url("https://fonts.googleapis.com/css2?family=Inter"); .a { color: red; }</style>`;
    expect(findTailwindImportTrap(plain)).toBeNull();
    expect(validateFilesWriteInputs({ path: "index.html", content: plain })).toBeNull();
  });

  it("returns null for content without any tailwindcss block", () => {
    expect(findTailwindImportTrap("<html><body>hello</body></html>")).toBeNull();
  });

  it("rejects an apply_patch whose replace introduces the trap", async () => {
    const err = await validateApplyPatchInputs(
      {
        path: "index.html",
        patches: [
          {
            search: "<head>",
            replace: `<head><style type="text/tailwindcss">@import url("https://fonts.googleapis.com/css2?family=Inter");</style>`,
          },
        ],
      },
      fakeTransport("<html><head></head></html>"),
    );
    expect(err).toContain("tailwindcss");
  });

  it("accepts an apply_patch whose replace carries the blessed pattern", async () => {
    const err = await validateApplyPatchInputs(
      {
        path: "index.html",
        patches: [{ search: "<head>", replace: `<head>${BLESSED}` }],
      },
      fakeTransport("<html><head></head></html>"),
    );
    expect(err).toBeNull();
  });
});
