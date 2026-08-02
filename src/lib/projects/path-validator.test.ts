import { describe, it, expect } from "vitest";
import {
  validateWorkspacePath,
  isValidWorkspacePath,
  pathErrorStatus,
  PathValidationError,
} from "./path-validator";

describe("validateWorkspacePath", () => {
  it("accepts a simple relative path", () => {
    expect(validateWorkspacePath("src/app/page.tsx")).toBe("src/app/page.tsx");
  });

  it("accepts a nested path with forward slashes", () => {
    expect(validateWorkspacePath("src/components/ui/Button.tsx")).toBe("src/components/ui/Button.tsx");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(validateWorkspacePath("src\\components\\Button.tsx")).toBe("src/components/Button.tsx");
  });

  it("strips leading ./ prefix", () => {
    expect(validateWorkspacePath("./src/page.tsx")).toBe("src/page.tsx");
  });

  it("accepts . as a read path (root listing)", () => {
    expect(validateWorkspacePath(".")).toBe(".");
  });

  // ── Rejections ──────────────────────────────────────────────

  it("rejects empty path", () => {
    expect(() => validateWorkspacePath("")).toThrow(PathValidationError);
    expect(() => validateWorkspacePath("")).toThrow(/Path is required/);
  });

  it("rejects whitespace-only path", () => {
    expect(() => validateWorkspacePath("   ")).toThrow(PathValidationError);
  });

  it("rejects .. traversal", () => {
    expect(() => validateWorkspacePath("../secret")).toThrow(/traversal/i);
  });

  it("rejects .. in middle of path", () => {
    expect(() => validateWorkspacePath("src/../etc/passwd")).toThrow(/traversal/i);
  });

  it("rejects .. at end of path", () => {
    expect(() => validateWorkspacePath("src/..")).toThrow(/traversal/i);
  });

  it("rejects POSIX absolute path", () => {
    expect(() => validateWorkspacePath("/etc/passwd")).toThrow(/Absolute/);
  });

  it("rejects Windows drive-letter path", () => {
    expect(() => validateWorkspacePath("C:\\Windows\\System32")).toThrow(/drive/i);
  });

  it("rejects Windows drive-letter with forward slash", () => {
    expect(() => validateWorkspacePath("C:/Users/secret")).toThrow(/drive/i);
  });

  it("rejects UNC path with backslashes", () => {
    expect(() => validateWorkspacePath("\\\\server\\share")).toThrow(/UNC/i);
  });

  it("rejects UNC path with forward slashes", () => {
    expect(() => validateWorkspacePath("//server/share")).toThrow(/UNC/i);
  });

  it("rejects null bytes", () => {
    expect(() => validateWorkspacePath("file\0.txt")).toThrow(/null/i);
  });

  it("rejects control characters", () => {
    expect(() => validateWorkspacePath("file\x01.txt")).toThrow(/control/i);
  });

  it("rejects DEL character (0x7F)", () => {
    expect(() => validateWorkspacePath("file\x7f.txt")).toThrow(/control/i);
  });

  it("rejects path that is too long", () => {
    const longPath = "a".repeat(600);
    expect(() => validateWorkspacePath(longPath)).toThrow(/exceeds/i);
  });

  // ── Delete-specific ─────────────────────────────────────────

  it("rejects root deletion", () => {
    expect(() => validateWorkspacePath(".", { isDelete: true })).toThrow(/root/i);
  });

  it("rejects deletion of .", () => {
    expect(() => validateWorkspacePath(".", { isDelete: true })).toThrow(PathValidationError);
  });

  it("allows deletion of a specific file", () => {
    expect(validateWorkspacePath("src/old.tsx", { isDelete: true })).toBe("src/old.tsx");
  });

  // ── Write size ──────────────────────────────────────────────

  it("rejects writes exceeding size limit", () => {
    expect(() =>
      validateWorkspacePath("big.txt", { contentLength: 11 * 1024 * 1024 }),
    ).toThrow(/exceeds/i);
  });

  it("allows writes within size limit", () => {
    expect(validateWorkspacePath("ok.txt", { contentLength: 1024 })).toBe("ok.txt");
  });

  // ── Encoded traversal ───────────────────────────────────────

  it("rejects encoded traversal %2e%2e", () => {
    expect(() => validateWorkspacePath("%2e%2e/secret")).toThrow(/traversal/i);
  });
});

describe("isValidWorkspacePath", () => {
  it("returns true for valid paths", () => {
    expect(isValidWorkspacePath("src/page.tsx")).toBe(true);
  });

  it("returns false for invalid paths", () => {
    expect(isValidWorkspacePath("../etc/passwd")).toBe(false);
    expect(isValidWorkspacePath("")).toBe(false);
    expect(isValidWorkspacePath("C:\\Windows")).toBe(false);
  });
});

describe("pathErrorStatus", () => {
  it("returns 400 for empty path", () => {
    expect(pathErrorStatus("EMPTY_PATH")).toBe(400);
  });

  it("returns 403 for traversal", () => {
    expect(pathErrorStatus("TRAVERSAL")).toBe(403);
  });

  it("returns 403 for drive letter", () => {
    expect(pathErrorStatus("DRIVE_LETTER")).toBe(403);
  });

  it("returns 403 for root delete", () => {
    expect(pathErrorStatus("ROOT_DELETE")).toBe(403);
  });

  it("returns 413 for path too long", () => {
    expect(pathErrorStatus("PATH_TOO_LONG")).toBe(413);
  });

  it("returns 413 for write too large", () => {
    expect(pathErrorStatus("WRITE_TOO_LARGE")).toBe(413);
  });
});
