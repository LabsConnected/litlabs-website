/**
 * Slash-command parser tests — command token vs argument separation.
 *
 * Tests the pure parsing logic that extracts the command token from a
 * slash-command input string. The command palette should only filter
 * on the command NAME, never on the arguments.
 */

import { describe, it, expect } from "vitest";
import { parseSlashCommand, shouldPaletteBeOpen, paletteQuery } from "../lib/slash-command-parser.js";

describe("slash-command parser: parseSlashCommand", () => {
  // ─── Basic parsing ─────────────────────────────────────────────

  it("parses bare '/' as empty command", () => {
    const parsed = parseSlashCommand("/");
    expect(parsed).not.toBeNull();
    expect(parsed!.command).toBe("");
    expect(parsed!.args).toBe("");
    expect(parsed!.hasSpace).toBe(false);
  });

  it("parses partial command '/loc'", () => {
    const parsed = parseSlashCommand("/loc");
    expect(parsed!.command).toBe("loc");
    expect(parsed!.args).toBe("");
    expect(parsed!.hasSpace).toBe(false);
  });

  it("parses complete command '/local'", () => {
    const parsed = parseSlashCommand("/local");
    expect(parsed!.command).toBe("local");
    expect(parsed!.args).toBe("");
    expect(parsed!.hasSpace).toBe(false);
  });

  // ─── Space detection ───────────────────────────────────────────

  it("parses '/local ' (trailing space) as hasSpace=true", () => {
    const parsed = parseSlashCommand("/local ");
    expect(parsed!.command).toBe("local");
    expect(parsed!.args).toBe("");
    expect(parsed!.hasSpace).toBe(true);
  });

  it("parses '/local where.exe' as command + args", () => {
    const parsed = parseSlashCommand("/local where.exe");
    expect(parsed!.command).toBe("local");
    expect(parsed!.args).toBe("where.exe");
    expect(parsed!.hasSpace).toBe(true);
  });

  it("parses '/local where.exe adb' as command + multi-word args", () => {
    const parsed = parseSlashCommand("/local where.exe adb");
    expect(parsed!.command).toBe("local");
    expect(parsed!.args).toBe("where.exe adb");
    expect(parsed!.hasSpace).toBe(true);
  });

  it("parses '/run git status' as command + args", () => {
    const parsed = parseSlashCommand("/run git status");
    expect(parsed!.command).toBe("run");
    expect(parsed!.args).toBe("git status");
    expect(parsed!.hasSpace).toBe(true);
  });

  it("parses '/remote' as command with no args", () => {
    const parsed = parseSlashCommand("/remote");
    expect(parsed!.command).toBe("remote");
    expect(parsed!.args).toBe("");
    expect(parsed!.hasSpace).toBe(false);
  });

  it("parses '/notreal' as unknown command", () => {
    const parsed = parseSlashCommand("/notreal");
    expect(parsed!.command).toBe("notreal");
    expect(parsed!.args).toBe("");
    expect(parsed!.hasSpace).toBe(false);
  });

  // ─── Non-slash input ───────────────────────────────────────────

  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("@context")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });

  // ─── raw field ─────────────────────────────────────────────────

  it("preserves the raw input", () => {
    expect(parseSlashCommand("/local where.exe adb")!.raw).toBe("/local where.exe adb");
    expect(parseSlashCommand("/remote")!.raw).toBe("/remote");
  });
});

describe("slash-command parser: shouldPaletteBeOpen", () => {
  it("palette open for bare '/'", () => {
    expect(shouldPaletteBeOpen("/")).toBe(true);
  });

  it("palette open for partial command '/loc'", () => {
    expect(shouldPaletteBeOpen("/loc")).toBe(true);
  });

  it("palette open for complete command '/local' (no space)", () => {
    expect(shouldPaletteBeOpen("/local")).toBe(true);
  });

  it("palette CLOSED for '/local ' (space typed)", () => {
    expect(shouldPaletteBeOpen("/local ")).toBe(false);
  });

  it("palette CLOSED for '/local where.exe adb'", () => {
    expect(shouldPaletteBeOpen("/local where.exe adb")).toBe(false);
  });

  it("palette CLOSED for '/run git status'", () => {
    expect(shouldPaletteBeOpen("/run git status")).toBe(false);
  });

  it("palette CLOSED for non-slash input", () => {
    expect(shouldPaletteBeOpen("hello")).toBe(false);
    expect(shouldPaletteBeOpen("")).toBe(false);
  });
});

describe("slash-command parser: paletteQuery", () => {
  it("query is empty for bare '/'", () => {
    expect(paletteQuery("/")).toBe("");
  });

  it("query is 'loc' for '/loc'", () => {
    expect(paletteQuery("/loc")).toBe("loc");
  });

  it("query is 'local' for '/local'", () => {
    expect(paletteQuery("/local")).toBe("local");
  });

  it("query is 'local' for '/local where.exe adb' (args excluded)", () => {
    // The critical test: arguments must NOT be part of the palette query
    expect(paletteQuery("/local where.exe adb")).toBe("local");
  });

  it("query is 'run' for '/run git status'", () => {
    expect(paletteQuery("/run git status")).toBe("run");
  });

  it("query is empty for non-slash input", () => {
    expect(paletteQuery("hello")).toBe("");
  });
});
