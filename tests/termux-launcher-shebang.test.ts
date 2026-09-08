/**
 * Regression: scripts/install-termux.sh generated the litt launcher with
 * a hardcoded `#!/bin/bash` shebang. Termux has no /bin/bash — bash lives
 * at $PREFIX/bin/bash — so the installed ~/.local/bin/litt could not run
 * ("No such file or directory" on exec) until manually patched.
 *
 * scripts/lib/launcher-shell.sh now resolves the bash path per-platform,
 * and scripts/lib/write-launcher.sh writes the launcher using it. These
 * tests exercise both directly via bash subprocesses (no real install
 * required) across Termux, plain Linux/macOS, and missing/invalid PREFIX.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..");
const launcherShellPath = path.join(repoRoot, "scripts/lib/launcher-shell.sh");
const writeLauncherPath = path.join(repoRoot, "scripts/lib/write-launcher.sh");

/**
 * Builds a subprocess env from the real process.env with the given
 * overrides applied (`undefined` deletes the key). This session runs
 * inside Termux, so process.env.PREFIX is already set to the real
 * Termux prefix — cases simulating "no PREFIX" must delete it, not just
 * omit it from an object literal.
 */
function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function getLauncherBashPath(env: NodeJS.ProcessEnv): string {
  return execFileSync(
    "bash",
    ["-c", `source "${launcherShellPath}" && get_launcher_bash_path`],
    { env, encoding: "utf8" },
  ).trim();
}

function writeLauncherTo(dest: string, env: NodeJS.ProcessEnv): string {
  execFileSync(
    "bash",
    ["-c", `source "${writeLauncherPath}" && write_litt_launcher "$1"`, "_", dest],
    { env, encoding: "utf8" },
  );
  return fs.readFileSync(dest, "utf8");
}

describe("termux launcher shebang", () => {
  let fakeTermuxRoot: string;
  let fakeBashPath: string;
  let scratchDir: string;

  beforeAll(() => {
    fakeTermuxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "litt-fake-prefix-"));
    fs.mkdirSync(path.join(fakeTermuxRoot, "bin"), { recursive: true });
    fakeBashPath = path.join(fakeTermuxRoot, "bin", "bash");
    fs.writeFileSync(fakeBashPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(fakeBashPath, 0o755);

    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-launcher-out-"));
  });

  afterAll(() => {
    fs.rmSync(fakeTermuxRoot, { recursive: true, force: true });
    fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("resolves ${PREFIX}/bin/bash on Termux (PREFIX set, bash present)", () => {
    const result = getLauncherBashPath(envWith({ PREFIX: fakeTermuxRoot }));
    expect(result).toBe(fakeBashPath);
  });

  it("retains /bin/bash on normal Linux/macOS (no PREFIX)", () => {
    const result = getLauncherBashPath(envWith({ PREFIX: undefined }));
    expect(result).toBe("/bin/bash");
  });

  it("falls back to /bin/bash when PREFIX is empty", () => {
    const result = getLauncherBashPath(envWith({ PREFIX: "" }));
    expect(result).toBe("/bin/bash");
  });

  it("falls back to /bin/bash when PREFIX is set but has no bash binary", () => {
    const result = getLauncherBashPath(envWith({ PREFIX: "/nonexistent/prefix" }));
    expect(result).toBe("/bin/bash");
  });

  it("writes a launcher with the complete Termux shebang", () => {
    const dest = path.join(scratchDir, "litt-launcher-termux.sh");
    const content = writeLauncherTo(dest, envWith({ PREFIX: fakeTermuxRoot }));

    expect(content.split("\n")[0]).toBe(`#!${fakeBashPath}`);
    expect(content).toContain("LiTT launcher");
    expect(fs.statSync(dest).mode & 0o111).not.toBe(0);
  });

  it("writes a launcher with the standard shebang off Termux", () => {
    const dest = path.join(scratchDir, "litt-launcher-linux.sh");
    const content = writeLauncherTo(dest, envWith({ PREFIX: undefined }));

    expect(content.split("\n")[0]).toBe("#!/bin/bash");
    expect(content).toContain("LiTT launcher");
  });
});
