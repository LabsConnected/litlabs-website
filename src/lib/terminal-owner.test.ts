/**
 * Tests for the web-app terminal owner allowlist helper (Part I).
 *
 * The terminal server's owner gate (terminal-server/terminal-owner-gate.ts)
 * is AUTHORITATIVE — it returns Forbidden for non-owners by design.
 * This module mirrors the allowlist so the web app can truthfully report
 * terminal health (Part F) instead of advertising a tool that will fail.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTerminalOwnerIds, isTerminalOwnerUser } from "./terminal-owner";

const ENV_KEY = "TERMINAL_OWNER_CLERK_IDS";
const ALLOWED_KEY = "TERMINAL_ALLOWED_CLERK_IDS";
let saved: string | undefined;
let savedAllowed: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
  savedAllowed = process.env[ALLOWED_KEY];
  delete process.env[ALLOWED_KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
  if (savedAllowed === undefined) delete process.env[ALLOWED_KEY];
  else process.env[ALLOWED_KEY] = savedAllowed;
});

describe("terminal owner allowlist (web-app view)", () => {
  it("defaults to the workspace owner when env is unset", () => {
    delete process.env[ENV_KEY];
    expect(getTerminalOwnerIds()).toEqual(["user_3GsAlPRx3ihYhftgAQ8Owr1uxzF"]);
    expect(isTerminalOwnerUser("user_3GsAlPRx3ihYhftgAQ8Owr1uxzF")).toBe(true);
    expect(isTerminalOwnerUser("user_testaccount")).toBe(false);
  });

  it("parses comma-separated env allowlist", () => {
    process.env[ENV_KEY] = "user_aaa, user_bbb ,,";
    expect(getTerminalOwnerIds()).toEqual(["user_aaa", "user_bbb"]);
    expect(isTerminalOwnerUser("user_bbb")).toBe(true);
    expect(isTerminalOwnerUser("user_ccc")).toBe(false);
  });

  it("prefers the new terminal allowlist over the legacy owner key", () => {
    process.env[ENV_KEY] = "user_old";
    process.env[ALLOWED_KEY] = " user_new ,, ";
    expect(getTerminalOwnerIds()).toEqual(["user_new"]);
    expect(isTerminalOwnerUser("user_new")).toBe(true);
    expect(isTerminalOwnerUser("user_old")).toBe(false);
  });

  it("honors an explicitly empty allowlist and denies access", () => {
    process.env[ENV_KEY] = "user_old";
    process.env[ALLOWED_KEY] = "   ";
    expect(getTerminalOwnerIds()).toEqual([]);
    expect(isTerminalOwnerUser("user_old")).toBe(false);
  });

  it("rejects null/undefined/empty user IDs", () => {
    process.env[ENV_KEY] = "user_aaa";
    expect(isTerminalOwnerUser(null)).toBe(false);
    expect(isTerminalOwnerUser(undefined)).toBe(false);
    expect(isTerminalOwnerUser("")).toBe(false);
  });
});
