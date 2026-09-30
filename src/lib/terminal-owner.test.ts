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
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
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

  it("rejects null/undefined/empty user IDs", () => {
    process.env[ENV_KEY] = "user_aaa";
    expect(isTerminalOwnerUser(null)).toBe(false);
    expect(isTerminalOwnerUser(undefined)).toBe(false);
    expect(isTerminalOwnerUser("")).toBe(false);
  });
});
