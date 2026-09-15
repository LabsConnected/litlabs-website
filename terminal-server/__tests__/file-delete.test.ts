import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { deleteResolvedPath } from "../workspace/FileService";

/**
 * Truthful delete.
 *
 * Both /files/delete and /ws-files/delete used rmSync(force:true) directly,
 * which reports success for a path that never existed — the API would
 * claim `deleted: true` while nothing happened, and a second delete of an
 * already-removed file looked identical to the first. deleteResolvedPath
 * throws "Path not found" so the routes can answer 404 honestly.
 */
const FIXTURE = mkdtempSync(join(tmpdir(), "litt-delete-"));

afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

describe("deleteResolvedPath", () => {
  it("deletes an existing file", () => {
    const target = join(FIXTURE, "exists.txt");
    writeFileSync(target, "bye");
    deleteResolvedPath(target);
    expect(existsSync(target)).toBe(false);
  });

  it("deletes a directory recursively", () => {
    const dir = join(FIXTURE, "dir-to-remove");
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "nested", "f.txt"), "x");
    deleteResolvedPath(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("throws 'Path not found' for a path that does not exist", () => {
    expect(() => deleteResolvedPath(join(FIXTURE, "nope.txt"))).toThrow("Path not found");
  });

  it("a second delete of the same path reports not-found, not success", () => {
    const target = join(FIXTURE, "once.txt");
    writeFileSync(target, "x");
    deleteResolvedPath(target);
    expect(() => deleteResolvedPath(target)).toThrow("Path not found");
  });
});
