import { describe, expect, it } from "vitest";
import { parseFileRef } from "./file-ref";

describe("parseFileRef (Kimi wiring item 4)", () => {
  it("parses a path:line:column reference from compiler output", () => {
    expect(
      parseFileRef("src/app/(app)/studio/components/BoardPanel.tsx:269:7 - error TS2322"),
    ).toEqual({
      path: "src/app/(app)/studio/components/BoardPanel.tsx",
      line: 269,
      column: 7,
    });
  });

  it("parses the path(line,column) form", () => {
    expect(parseFileRef("Build failed: terminal-server/sandbox/env.ts(12,5): error")).toEqual({
      path: "terminal-server/sandbox/env.ts",
      line: 12,
      column: 5,
    });
  });

  it("parses a bare filename only when it carries a line", () => {
    expect(parseFileRef("page.tsx:42 something broke")).toEqual({ path: "page.tsx", line: 42 });
  });

  it("parses a slashed path without a line", () => {
    expect(parseFileRef("Error in ./src/lib/foo.ts at line 3")).toEqual({ path: "./src/lib/foo.ts" });
  });

  it("rejects prose that merely looks dotted", () => {
    expect(parseFileRef("Node.js 20 is required for this project")).toBeNull();
    expect(parseFileRef("Visit https://example.com/docs for details")).toBeNull();
    expect(parseFileRef("no files here at all")).toBeNull();
    expect(parseFileRef(null)).toBeNull();
    expect(parseFileRef("")).toBeNull();
  });
});
