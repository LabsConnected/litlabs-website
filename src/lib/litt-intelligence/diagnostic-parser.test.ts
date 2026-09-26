import { describe, expect, it } from "vitest";
import { parseDiagnostics } from "./diagnostic-parser";

describe("parseDiagnostics", () => {
  it("extracts file, line, severity, and message from compiler output", () => {
    const diagnostics = parseDiagnostics(
      "src/App.tsx:12:7 - error TS2322: Type 'string' is not assignable\nwarning: unused variable",
      "typecheck",
    );

    expect(diagnostics).toEqual([
      {
        file: "src/App.tsx",
        line: 12,
        column: 7,
        severity: "error",
        message: "TS2322: Type 'string' is not assignable",
        source: "typecheck",
      },
      {
        file: undefined,
        line: undefined,
        column: undefined,
        severity: "warning",
        message: "unused variable",
        source: "typecheck",
      },
    ]);
  });

  it("deduplicates and bounds noisy output", () => {
    const output = Array.from({ length: 150 }, () => "src/a.ts:1:1 - error: broken").join("\n");
    const diagnostics = parseDiagnostics(output, "test");
    expect(diagnostics).toHaveLength(1);
  });
});
