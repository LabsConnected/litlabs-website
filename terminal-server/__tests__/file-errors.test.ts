/**
 * file-errors.ts — regression coverage for the file-endpoint error contract.
 *
 * Demonstrated failure (mission 2026-10-30, live trace on :3001/:4001):
 *   POST /ws-files/read for a missing file returned HTTP 500 with a raw
 *   ENOENT message that leaked the absolute host path
 *   ("ENOENT: no such file or directory, stat 'C:\LiTT\...'").
 * Contract restored here: ENOENT = routine missing file → clean 404,
 * never a 500 and never the stat path.
 */

import { describe, it, expect } from "vitest";
import {
  fileErrorResponse,
  fileErrorStatus,
  isPathValidationError,
} from "../file-errors";

function enoent(): Error & { code: string } {
  const e = new Error(
    "ENOENT: no such file or directory, stat 'C:\\host\\secret\\path\\missing.html'",
  ) as Error & { code: string };
  e.code = "ENOENT";
  return e;
}

describe("fileErrorResponse", () => {
  it("maps ENOENT-code errors to a clean 404 with no host path", () => {
    const r = fileErrorResponse(enoent(), "Failed to read file");
    expect(r.status).toBe(404);
    expect(r.error).toBe("File not found");
    expect(r.error).not.toContain("ENOENT");
    expect(r.error).not.toContain("C:\\");
  });

  it("maps ENOENT-message-only errors (no code) to 404", () => {
    const r = fileErrorResponse(
      new Error("ENOENT: no such file or directory, open '/x/y'"),
      "Failed to read file",
    );
    expect(r.status).toBe(404);
    expect(r.error).toBe("File not found");
  });

  it("uses the caller's notFound label (list endpoints use 'Path not found')", () => {
    const r = fileErrorResponse(enoent(), "Failed to list files", "Path not found");
    expect(r).toEqual({ status: 404, error: "Path not found" });
  });

  it("keeps workspace-missing at 404", () => {
    const r = fileErrorResponse(new Error("Workspace not found"), "Failed to read file");
    expect(r).toEqual({ status: 404, error: "Workspace not found" });
  });

  it("keeps path-validation failures at 400", () => {
    for (const msg of [
      "Invalid path",
      "Path too long",
      "Absolute or parent paths are not allowed",
      "Path escapes workspace root",
      "Symlink escapes workspace root",
    ]) {
      expect(fileErrorResponse(new Error(msg), "x").status).toBe(400);
    }
  });

  it("keeps Forbidden at 403", () => {
    expect(fileErrorResponse(new Error("Forbidden"), "x").status).toBe(403);
  });

  it("maps unknown errors to 500 with the original message", () => {
    const r = fileErrorResponse(new Error("disk on fire"), "Failed to read file");
    expect(r).toEqual({ status: 500, error: "disk on fire" });
  });

  it("uses the fallback for non-Error throws", () => {
    const r = fileErrorResponse("string-throw", "Failed to read file");
    expect(r.status).toBe(500);
    expect(r.error).toBe("Failed to read file");
  });
});

describe("fileErrorStatus / isPathValidationError", () => {
  it("statuses match the endpoint contract", () => {
    expect(fileErrorStatus("Forbidden")).toBe(403);
    expect(fileErrorStatus("Workspace not found")).toBe(404);
    expect(fileErrorStatus("Path not found")).toBe(404);
    expect(fileErrorStatus("Invalid path")).toBe(400);
    expect(fileErrorStatus("boom")).toBe(500);
  });

  it("only the exact path-validation messages classify as 400", () => {
    expect(isPathValidationError("Path escapes workspace root")).toBe(true);
    expect(isPathValidationError("path escapes workspace root")).toBe(false);
    expect(isPathValidationError("Invalid path: ../x")).toBe(false);
  });
});
