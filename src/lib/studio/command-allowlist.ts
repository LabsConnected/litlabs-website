/**
 * Commands the browser-side /api/studio/command bridge accepts and forwards
 * to terminal-server's /internal/command.
 *
 * Contract: every name here MUST resolve in terminal-server's command
 * registry (terminal-server/command-registry.ts) — by command name or
 * alias — because that registry is the single dispatch truth. A name that
 * does not resolve passes web validation only to fail downstream, so this
 * list is kept deliberately small: project introspection and workspace
 * commands that exist today.
 *
 * Notably absent by design:
 *   - `do`     — arbitrary shell execution (workspace_edit); not a
 *                browser-callable surface.
 *   - `ask`, `web`, `model`, `doctor`, `studio`, `local`, `help` — agent
 *                or lane-management commands handled by other surfaces.
 *   - `log`, `branch`, `list_files`, `read_file`, `inspect_package`,
 *     `debug`, `ship` — names that were previously advertised but have no
 *     registry command; they always failed. `git` covers log/branch/show.
 *
 * Parity is enforced by
 * terminal-server/__tests__/command-bridge-web-allowlist.test.ts.
 */
export const STUDIO_COMMAND_ALLOWLIST = [
  "status",
  "diff",
  "check",
  "test",
  "build",
  "git",
  "search",
] as const;

export type StudioCommandName = (typeof STUDIO_COMMAND_ALLOWLIST)[number];
