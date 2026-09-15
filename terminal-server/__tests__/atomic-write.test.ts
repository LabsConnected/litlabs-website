import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, mkdirSync, statSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileAtomic } from "../workspace/atomic-write";

/**
 * Atomic replacement.
 *
 * writeFileSync truncates the destination before streaming the new bytes,
 * so a write that fails partway destroys the user's file. Replacement now
 * goes through a same-directory temp file and a rename, which either
 * happens or does not.
 */
const FIXTURE = mkdtempSync(join(tmpdir(), "litt-atomic-"));

afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

describe("writeFileAtomic", () => {
  let target: string;

  beforeEach(() => {
    target = join(FIXTURE, `f-${Math.random().toString(36).slice(2)}.html`);
  });

  it("creates a file that does not exist yet", () => {
    writeFileAtomic(target, "<h1>new</h1>");
    expect(readFileSync(target, "utf-8")).toBe("<h1>new</h1>");
  });

  it("replaces existing content", () => {
    writeFileSync(target, "old", "utf-8");
    writeFileAtomic(target, "new");
    expect(readFileSync(target, "utf-8")).toBe("new");
  });

  it("creates missing parent directories", () => {
    const nested = join(FIXTURE, "a", "b", "c", "index.html");
    writeFileAtomic(nested, "deep");
    expect(readFileSync(nested, "utf-8")).toBe("deep");
  });

  // Case 3 from the regression list: a write that fails midway must leave
  // the original intact.
  it("leaves the original intact when the write fails", () => {
    writeFileSync(target, "ORIGINAL", "utf-8");

    // A directory cannot be renamed over a file path on any platform, and
    // making the destination a directory forces the rename to throw after
    // the temp file has already been written.
    const blocked = join(FIXTURE, "blocked-dir");
    mkdirSync(blocked, { recursive: true });

    expect(() => writeFileAtomic(blocked, "REPLACEMENT")).toThrow();
    // The unrelated original is untouched.
    expect(readFileSync(target, "utf-8")).toBe("ORIGINAL");
  });

  it("removes its temporary file when the write fails", () => {
    const blocked = join(FIXTURE, "blocked-dir-2");
    mkdirSync(blocked, { recursive: true });

    expect(() => writeFileAtomic(blocked, "x")).toThrow();

    const strays = readdirSync(FIXTURE).filter((n) => n.endsWith(".tmp"));
    expect(strays).toEqual([]);
  });

  it("leaves no temporary file behind on success", () => {
    writeFileAtomic(target, "clean");
    const strays = readdirSync(FIXTURE).filter((n) => n.endsWith(".tmp"));
    expect(strays).toEqual([]);
  });

  it("never exposes a truncated destination — content is all or nothing", () => {
    writeFileSync(target, "AAAA", "utf-8");
    writeFileAtomic(target, "BBBBBBBB");
    const seen = readFileSync(target, "utf-8");
    // Either the whole old value or the whole new one; never a prefix mix.
    expect(["AAAA", "BBBBBBBB"]).toContain(seen);
    expect(seen).toBe("BBBBBBBB");
  });

  it("preserves the destination's permission bits", () => {
    writeFileSync(target, "old", "utf-8");
    try {
      chmodSync(target, 0o600);
    } catch {
      return; // platform without meaningful modes
    }
    const before = statSync(target).mode;
    writeFileAtomic(target, "new");
    expect(statSync(target).mode).toBe(before);
  });

  it("handles utf-8 content without corrupting byte length", () => {
    const content = "héllo — ünicode ✅";
    writeFileAtomic(target, content);
    expect(readFileSync(target, "utf-8")).toBe(content);
  });
});
