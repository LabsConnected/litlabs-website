/**
 * FakeShell — scripted ShellExecutor for android/dex tests.
 *
 * Records every invocation and answers from a responder list matched
 * against command + args. Unmatched calls return `defaultResult`.
 */

import type {
  ShellExecutor,
  ShellExecuteOptions,
  ShellResult,
} from "@litt/agent-core";

export type ShellResponder = Partial<ShellResult> | ((o: ShellExecuteOptions) => Partial<ShellResult>);

export function shellOk(stdout = "", extra: Partial<ShellResult> = {}): Partial<ShellResult> {
  return { ok: true, status: "success", exitCode: 0, stdout, stderr: "", ...extra };
}

export function shellFail(stderr: string, exitCode = 1, extra: Partial<ShellResult> = {}): Partial<ShellResult> {
  return { ok: false, status: "failed", exitCode, stdout: "", stderr, ...extra };
}

export class FakeShell implements ShellExecutor {
  readonly cwd: string;
  readonly platform: NodeJS.Platform = "win32";
  readonly environment: Record<string, string> = {};

  calls: ShellExecuteOptions[] = [];
  defaultResult: Partial<ShellResult> = shellFail("fake-shell: unscripted call");

  private responders: Array<{ match: (o: ShellExecuteOptions) => boolean; res: ShellResponder }> = [];

  constructor(cwd = "C:\proj") {
    this.cwd = cwd;
  }

  /** Register a responder. match receives the full options object. */
  on(match: (o: ShellExecuteOptions) => boolean, res: ShellResponder): this {
    this.responders.push({ match, res });
    return this;
  }

  /**
   * Convenience: match when each token appears (in order) as a
   * substring of successive argv elements. Substring matching is needed
   * because adb forwards compound on-device commands as single argv
   * elements (e.g. "dumpsys power | grep -E ...").
   */
  onArgv(tokens: string[], res: ShellResponder): this {
    return this.on(
      (o) => {
        const args = o.args ?? [];
        let i = 0;
        for (const t of tokens) {
          let found = -1;
          for (let j = i; j < args.length; j++) {
            if (args[j].includes(t)) { found = j; break; }
          }
          if (found === -1) return false;
          i = found + 1;
        }
        return true;
      },
      res,
    );
  }

  async execute(options: ShellExecuteOptions): Promise<ShellResult> {
    this.calls.push(options);
    const r = this.responders.find((x) => x.match(options));
    const partial = r
      ? typeof r.res === "function" ? r.res(options) : r.res
      : this.defaultResult;
    return {
      ok: partial.ok ?? true,
      status: partial.status ?? (partial.ok === false ? "failed" : "success"),
      stdout: partial.stdout ?? "",
      stderr: partial.stderr ?? "",
      exitCode: partial.exitCode ?? (partial.ok === false ? 1 : 0),
      durationMs: partial.durationMs ?? 5,
      command: options.command,
      args: options.args ?? [],
      truncated: partial.truncated ?? false,
      error: partial.error,
      pid: partial.pid ?? 1,
    };
  }

  async cancel(): Promise<number[]> {
    return [];
  }
}

/** The canonical adb devices -l line for the authorized test device. */
export const TEST_SERIAL = "LBMRAIFEVSNRMFRO";
export const DEVICES_L =
  `List of devices attached\n` +
  `${TEST_SERIAL}       device product:McCarty model:Celero3_5G_ device:U695DS transport_id:2\n`;

/** Script a fake shell for the common "device connected" baseline. */
export function withDevices(shell: FakeShell, output = DEVICES_L): FakeShell {
  return shell.onArgv(["devices", "-l"], shellOk(output));
}
