import { describe, it, expect } from "vitest";

/**
 * Web bridge allowlist ↔ command registry parity.
 *
 * /api/studio/command accepts only names in STUDIO_COMMAND_ALLOWLIST and
 * forwards them to /internal/command, which dispatches through the
 * registry. Any allowlisted name that does not resolve here — by command
 * name or alias — would pass web validation and then always fail
 * downstream. This test makes that drift impossible: the web allowlist
 * must be a subset of what the registry can actually execute.
 */

import { resolveCommand, getCommandNames } from "../command-registry";
import { STUDIO_COMMAND_ALLOWLIST } from "../../src/lib/studio/command-allowlist";

describe("STUDIO_COMMAND_ALLOWLIST parity with the command registry", () => {
  it("is non-empty", () => {
    expect(STUDIO_COMMAND_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it.each([...STUDIO_COMMAND_ALLOWLIST])(
    "resolves web-bridge command %s in the registry",
    (name) => {
      expect(resolveCommand(name), `/${name} must exist in the registry`).not.toBeNull();
    },
  );

  it("does not expose the arbitrary-shell command to the browser lane", () => {
    expect(STUDIO_COMMAND_ALLOWLIST).not.toContain("do");
    expect(STUDIO_COMMAND_ALLOWLIST).not.toContain("local");
  });

  it("allows the registry's git command (log/branch/show subcommands)", () => {
    expect(STUDIO_COMMAND_ALLOWLIST).toContain("git");
    expect(resolveCommand("git")?.spec.mutability).toBe("read_only");
  });

  it("keeps `search` resolvable as the web-search alias", () => {
    expect(resolveCommand("search")?.spec.command).toBe("web");
  });

  it("registry exposes every allowlisted name in /help output", () => {
    const names = new Set(getCommandNames());
    const aliases = new Set(
      [...STUDIO_COMMAND_ALLOWLIST]
        .map((n) => resolveCommand(n)?.spec.command)
        .filter((c): c is string => Boolean(c)),
    );
    for (const canonical of aliases) {
      expect(names.has(canonical)).toBe(true);
    }
  });
});
