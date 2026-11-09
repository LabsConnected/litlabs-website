import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkExpectedSha256, sha256Utf8 } from "../workspace/cas";

describe("workspace CAS (expectedSha256)", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "litt-cas-"));
    file = join(dir, "index.html");
    writeFileSync(file, "<html>v1</html>", "utf-8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a write pinned to the current content hash", () => {
    const v = checkExpectedSha256(file, sha256Utf8("<html>v1</html>"));
    expect(v.ok).toBe(true);
    expect(v.currentSha256).toBe(sha256Utf8("<html>v1</html>"));
  });

  it("rejects a stale hash after the file changed", () => {
    writeFileSync(file, "<html>v2 — agent edit</html>", "utf-8");
    const v = checkExpectedSha256(file, sha256Utf8("<html>v1</html>"));
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/changed since/);
    expect(v.currentSha256).toBe(sha256Utf8("<html>v2 — agent edit</html>"));
  });

  it("rejects a pinned hash when the file is missing", () => {
    rmSync(file);
    const v = checkExpectedSha256(file, sha256Utf8("<html>v1</html>"));
    expect(v.ok).toBe(false);
    expect(v.currentSha256).toBeNull();
  });

  it('"absent" sentinel allows creation only when the file does not exist', () => {
    const missing = join(dir, "new.html");
    expect(checkExpectedSha256(missing, "absent").ok).toBe(true);
    const v = checkExpectedSha256(file, "absent");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/already exists/);
  });

  it("hashes utf-8 bytes so browser/server bases agree", () => {
    writeFileSync(file, "café ✓", "utf-8");
    expect(sha256Utf8("café ✓")).toBe(sha256Utf8("café ✓"));
    expect(checkExpectedSha256(file, sha256Utf8("café ✓")).ok).toBe(true);
    expect(existsSync(file)).toBe(true);
  });
});
