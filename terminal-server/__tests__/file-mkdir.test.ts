import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirResolvedPath } from "../workspace/FileService";

/**
 * Recursive mkdir for /ws-files/mkdir.
 *
 * The route used mkdirSync(..., { recursive: false }), so creating a
 * nested folder whose parents don't exist yet (e.g. `assets/images`
 * before `assets`) threw ENOENT, which file-errors maps to a 404 tool
 * failure in agent run logs — even though the step is harmless (the
 * write endpoint creates parents itself). mkdirResolvedPath creates
 * missing parents and reports "exists" for a target that is already
 * there, so the route can keep answering its 409 pre-check truthfully.
 */
const FIXTURE = mkdtempSync(join(tmpdir(), "litt-mkdir-"));

afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }));

describe("mkdirResolvedPath", () => {
  it("creates a nested directory whose parents do not exist yet", () => {
    const target = join(FIXTURE, "assets", "images");
    expect(mkdirResolvedPath(target)).toBe("created");
    expect(existsSync(target)).toBe(true);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it("creates a single-level directory", () => {
    const target = join(FIXTURE, "plain");
    expect(mkdirResolvedPath(target)).toBe("created");
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it("reports 'exists' for a directory that is already there", () => {
    const target = join(FIXTURE, "assets", "images");
    expect(mkdirResolvedPath(target)).toBe("exists");
  });

  it("reports 'exists' for a file that is already there (409 pre-check covers files too)", () => {
    const target = join(FIXTURE, "file.txt");
    writeFileSync(target, "x");
    expect(mkdirResolvedPath(target)).toBe("exists");
  });
});
