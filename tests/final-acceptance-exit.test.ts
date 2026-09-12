import { describe, it, expect } from "vitest";
import { exitCodeForVerdict } from "../scripts/final-acceptance/verdict-exit.mjs";

describe("golden verdict exit code", () => {
  it("returns 0 for a PASS verdict", () => {
    expect(exitCodeForVerdict({ verdict: "PASS" })).toBe(0);
  });

  it("returns 1 for any failed or runner-error verdict", () => {
    expect(exitCodeForVerdict({ verdict: "FAIL: files_written" })).toBe(1);
    expect(exitCodeForVerdict({ verdict: "RUNNER_ERROR" })).toBe(1);
    expect(exitCodeForVerdict({ verdict: "FAIL: files_written, preview_event, assistant_completed" })).toBe(1);
  });

  it("returns 1 for a missing/invalid verdict payload", () => {
    expect(exitCodeForVerdict(undefined as unknown as { verdict: string })).toBe(1);
    expect(exitCodeForVerdict({} as { verdict: string })).toBe(1);
    expect(exitCodeForVerdict(null as unknown as { verdict: string })).toBe(1);
  });

  it("treats any PASS prefix as success", () => {
    expect(exitCodeForVerdict({ verdict: "PASS: all checks" })).toBe(0);
    expect(exitCodeForVerdict({ verdict: "PASS: files_written, preview_event" })).toBe(0);
  });

  it("returns 1 for malformed or unknown verdict values", () => {
    expect(exitCodeForVerdict({ verdict: "" })).toBe(1);
    expect(exitCodeForVerdict({ verdict: "PASSED" })).toBe(1);
    expect(exitCodeForVerdict({ verdict: "UNKNOWN" })).toBe(1);
    expect(exitCodeForVerdict({ verdict: 42 as unknown as string })).toBe(1);
  });
});
