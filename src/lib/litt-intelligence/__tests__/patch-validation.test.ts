// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";
import { buildPatchRecoveryMessage, findTailwindImportTrap, findTailwindThemeV3Config, validateApplyPatchInputs, validateFilesWriteInputs } from "../patch-validation";
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

  function spyTransport(fileContent?: string) {
    return {
      workspaceId: "ws-1",
      readFile: vi.fn(async () => ({ content: fileContent ?? "", size: (fileContent ?? "").length })),
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

  // Tailwind v4 browser-build floor: the loop's pre-approval gate is not
  // the only mutation path — /api/litt/tools/execute and resumed approvals
  // reach these handlers directly. A v3 @theme or a bare @import compiles
  // ZERO utilities (silently unstyled page), so the handlers must refuse.
  it("files.write rejects a v3 config object inside @theme", async () => {
    const { handleFilesWrite } = await loadHandlers();
    const t = spyTransport();
    const res = await handleFilesWrite(
      {
        path: "index.html",
        content: `<style type="text/tailwindcss">@theme { colors: { primary: '#a8ff2f' } }</style>`,
      },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("@theme");
    expect(res.error).toContain("--color-primary");
    expect(t.writeFile).not.toHaveBeenCalled();
  });

  it("files.write rejects a fonts @import without tailwindcss", async () => {
    const { handleFilesWrite } = await loadHandlers();
    const t = spyTransport();
    const res = await handleFilesWrite(
      {
        path: "index.html",
        content: `<style type="text/tailwindcss">@import url("https://fonts.googleapis.com/css2?family=Inter");</style>`,
      },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("tailwindcss");
    expect(t.writeFile).not.toHaveBeenCalled();
  });

  it("apply_patch rejects a v3 theme introduced in replace without touching the transport", async () => {
    const { handleApplyPatch } = await loadHandlers();
    const t = spyTransport();
    const res = await handleApplyPatch(
      {
        path: "index.html",
        patches: [
          {
            search: "<head>",
            replace: `<head><style type="text/tailwindcss">@theme { extend: { colors: { primary: '#a8ff2f' } } }</style>`,
          },
        ],
      },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("@theme");
    expect(t.applyPatch).not.toHaveBeenCalled();
  });

  it("terminal.execute rejects a heredoc write carrying the v3 theme trap", async () => {
    const { handleTerminalExecute } = await loadHandlers();
    const t = spyTransport();
    const res = await handleTerminalExecute(
      {
        command:
          "cat > index.html <<'EOF'\n<style type=\"text/tailwindcss\">\n@theme { colors: { primary: '#a8ff2f' } }\n</style>\nEOF",
      },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("@theme");
    expect(t.exec).not.toHaveBeenCalled();
  });

  it("apply_patch rejects a partial edit that writes v3 syntax into an existing @theme", async () => {
    // The replace text carries no <style> block of its own — the v3
    // config only becomes visible in the post-patch file.
    const { handleApplyPatch } = await loadHandlers();
    const styled = `<style type="text/tailwindcss">@theme {\n  --color-primary: #a8ff2f;\n}</style>`;
    const t = spyTransport(styled);
    const res = await handleApplyPatch(
      {
        path: "index.html",
        patches: [{ search: "  --color-primary: #a8ff2f;", replace: "  colors: { primary: '#a8ff2f' }" }],
      },
      t,
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("@theme");
    expect(t.applyPatch).not.toHaveBeenCalled();
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

describe("findTailwindThemeV3Config — v3 config object inside @theme (P0)", () => {
  // Exact pattern observed in production: the model emitted a v3-style
  // theme object inside @theme — the v4 browser compiler throws
  // CssSyntaxError and compiles ZERO utilities (fully unstyled page).
  const V3_THEME = `<style type="text/tailwindcss">
@theme {
    colors: {
        primary: '#a8ff2f',
        dark: '#03050a',
    };
    extend: {
        fontFamily: {
            sans: ['Inter', 'sans-serif'],
        },
    }
}
.glass { backdrop-filter: blur(12px); }
</style>`;

  const V4_THEME = `<style type="text/tailwindcss">
@theme {
    --color-primary: #a8ff2f;
    --color-dark: #03050a;
    --font-sans: "Inter", sans-serif;
}
.glass { backdrop-filter: blur(12px); }
</style>`;

  const V4_THEME_KEYFRAMES = `<style type="text/tailwindcss">
@theme {
    --animate-pulse-slow: pulse-slow 3s infinite;
    @keyframes pulse-slow {
        to { opacity: 0.5; }
    }
}
</style>`;

  it("flags a v3 config object inside @theme", () => {
    const offender = findTailwindThemeV3Config(V3_THEME);
    expect(offender).not.toBeNull();
    expect(offender).toContain("colors");
  });

  it("accepts valid v4 @theme custom properties", () => {
    expect(findTailwindThemeV3Config(V4_THEME)).toBeNull();
  });

  it("does not false-positive on nested @keyframes inside @theme", () => {
    expect(findTailwindThemeV3Config(V4_THEME_KEYFRAMES)).toBeNull();
  });

  it("flags v3 quoted-literal properties at the block's top level", () => {
    const inline = `<style type="text/tailwindcss">@theme { primary: '#a8ff2f', }</style>`;
    expect(findTailwindThemeV3Config(inline)).not.toBeNull();
  });

  it("ignores @theme in plain <style> blocks", () => {
    const plain = `<style>@theme { colors: { primary: '#f00' } }</style>`;
    expect(findTailwindThemeV3Config(plain)).toBeNull();
  });

  it("rejects a files.write containing the v3 theme trap with a remediation message", () => {
    const err = validateFilesWriteInputs({ path: "index.html", content: V3_THEME });
    expect(err).toContain("rejected");
    expect(err).toContain("--color-primary");
    expect(err).toContain("ZERO utilities");
  });

  it("rejects an apply_patch whose replace introduces the v3 theme trap", async () => {
    const err = await validateApplyPatchInputs(
      {
        path: "index.html",
        patches: [{ search: "<head>", replace: `<head>${V3_THEME}` }],
      },
      fakeTransport("<html><head></head></html>"),
    );
    expect(err).toContain("rejected");
    expect(err).toContain("@theme");
  });
});

describe("validateApplyPatchInputs — resulting-file Tailwind check (partial patches)", () => {
  // Greptile P2 on PR #757: the per-replace scan only sees complete
  // <style type="text/tailwindcss"> blocks inside the patch text. A
  // partial edit inside an EXISTING block — e.g. swapping one
  // --color-primary line for `colors: { primary: … }` — carried no
  // block in the replace text, passed the gate, and left the page
  // unstyled. The validator must check the post-patch file, not just
  // the patch text.
  const STYLED_FILE = `<html><head>
<style type="text/tailwindcss">
@theme {
  --color-primary: #a8ff2f;
  --font-sans: "Inter", sans-serif;
}
</style></head><body><h1>Hi</h1></body></html>`;

  it("rejects a partial replace that writes v3 config syntax into @theme", async () => {
    const err = await validateApplyPatchInputs(
      {
        path: "index.html",
        patches: [{ search: "  --color-primary: #a8ff2f;", replace: "  colors: { primary: '#a8ff2f' }," }],
      },
      fakeTransport(STYLED_FILE),
    );
    expect(err).toContain("@theme");
  });

  it("rejects a partial replace that strips @import \"tailwindcss\" from a block with other imports", async () => {
    // The resulting file keeps a fonts @import but loses the tailwindcss
    // opt-out line — the browser build then compiles ZERO utilities.
    const file = `<style type="text/tailwindcss">
@import "tailwindcss";
@import url("https://fonts.googleapis.com/css2?family=Inter");
</style>`;
    const err = await validateApplyPatchInputs(
      { path: "index.html", patches: [{ search: '@import "tailwindcss";\n', replace: "" }] },
      fakeTransport(file),
    );
    expect(err).toContain("tailwindcss");
  });

  it("accepts a partial replace that keeps v4 custom-property syntax", async () => {
    const err = await validateApplyPatchInputs(
      {
        path: "index.html",
        patches: [{ search: "--color-primary: #a8ff2f;", replace: "--color-primary: #00ff88;" }],
      },
      fakeTransport(STYLED_FILE),
    );
    expect(err).toBeNull();
  });

  it("accepts edits outside the style block entirely", async () => {
    const err = await validateApplyPatchInputs(
      {
        path: "index.html",
        patches: [{ search: "<h1>Hi</h1>", replace: "<h1>Hello there</h1>" }],
      },
      fakeTransport(STYLED_FILE),
    );
    expect(err).toBeNull();
  });
});
