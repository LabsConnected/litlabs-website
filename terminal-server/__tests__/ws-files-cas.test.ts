import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkExpectedSha256, sha256Utf8 } from "../workspace/cas";

/**
 * /ws-files/write compare-and-swap.
 *
 * A client-side read-then-write is never safe: the check must happen at the
 * filesystem boundary, synchronously, immediately before writeFileSync.
 * These tests pin the contract the apply route and canvas sync depend on.
 */
const FIXTURE = mkdtempSync(join(tmpdir(), "litt-cas-"));

afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

describe("checkExpectedSha256", () => {
  it("accepts a write when the revision matches current bytes", () => {
    const f = join(FIXTURE, "a.html");
    writeFileSync(f, "v1");
    const v = checkExpectedSha256(f, sha256Utf8("v1"));
    expect(v.ok).toBe(true);
    expect(v.currentSha256).toBe(sha256Utf8("v1"));
  });

  it("rejects a stale revision and reports the current hash", () => {
    const f = join(FIXTURE, "b.html");
    writeFileSync(f, "v2-edited-by-someone-else");
    const v = checkExpectedSha256(f, sha256Utf8("v2-original"));
    expect(v.ok).toBe(false);
    expect(v.currentSha256).toBe(sha256Utf8("v2-edited-by-someone-else"));
    // The file is untouched — a rejected write must not mutate anything.
    expect(readFileSync(f, "utf-8")).toBe("v2-edited-by-someone-else");
  });

  it("rejects 'expected' writes when the file does not exist", () => {
    const v = checkExpectedSha256(join(FIXTURE, "missing.html"), sha256Utf8("x"));
    expect(v.ok).toBe(false);
    expect(v.currentSha256).toBeNull();
  });

  it("'absent' accepts a write only when the file truly does not exist", () => {
    const fresh = join(FIXTURE, "fresh.html");
    expect(checkExpectedSha256(fresh, "absent").ok).toBe(true);
    writeFileSync(fresh, "created concurrently");
    const v = checkExpectedSha256(fresh, "absent");
    expect(v.ok).toBe(false);
    expect(v.currentSha256).toBe(sha256Utf8("created concurrently"));
    expect(readFileSync(fresh, "utf-8")).toBe("created concurrently");
  });

  it("rejects a directory target", () => {
    expect(checkExpectedSha256(FIXTURE, sha256Utf8("x")).ok).toBe(false);
  });

  it("hash basis is utf-8 content — matches client/Next.js layers", () => {
    // é is multi-byte in utf-8; a byte-hash vs char-hash mismatch is exactly
    // the divergence this pins.
    expect(sha256Utf8("café")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Utf8("café")).not.toBe(sha256Utf8("cafe"));
  });
});
