// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";
import { validateApplyPatchInputs } from "../patch-validation";

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
