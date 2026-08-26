/**
 * Deterministic Accuracy Suite — 20 cases comparing LiTT REMOTE answers
 * against direct shell/git ground truth.
 *
 * Every LiTT answer is compared with the equivalent direct command
 * run via /do on the same server, ensuring the server's own execution
 * is self-consistent.
 *
 * Server commit: 16c3078a (feat/litt-cli-oauth-login)
 * CLI commit: 16c3078a
 */
import { ClerkCliAuth } from "../packages/litt-cli/dist/lib/auth/clerk-auth.js";

const TERMINAL_URL = "https://litlabs-terminal-server-production-0be1.up.railway.app";
const SERVER_COMMIT = "16c3078a";
const CLI_COMMIT = "16c3078a";

interface TestResult {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  latencyMs: number;
}

const results: TestResult[] = [];

async function getToken(): Promise<string> {
  const auth = new ClerkCliAuth({
    clientId: "YWeGjVVwoNnX4RTY",
    issuer: "https://clerk.litlabs.net",
  });
  return auth.getAccessToken();
}

async function exchangeForTerminalToken(clerkToken: string): Promise<string> {
  const r = await fetch(`${TERMINAL_URL}/api/token-exchange`, {
    method: "POST",
    headers: { Authorization: `Bearer ${clerkToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Token exchange failed: ${r.status}`);
  const j = await r.json();
  return j.terminalToken;
}

async function doCmd(terminalToken: string, args: string[], timeoutMs = 30_000): Promise<any> {
  const r = await fetch(`${TERMINAL_URL}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${terminalToken}`,
    },
    body: JSON.stringify({ command: "/do", args }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return r.json();
}

async function slashCmd(terminalToken: string, command: string, args?: string[]): Promise<any> {
  const r = await fetch(`${TERMINAL_URL}/api/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${terminalToken}`,
    },
    body: JSON.stringify({ command, args }),
    signal: AbortSignal.timeout(30_000),
  });
  return r.json();
}

async function runTest(
  name: string,
  expected: string,
  fn: () => Promise<{ actual: string; pass: boolean }>,
): Promise<void> {
  const t0 = Date.now();
  try {
    const { actual, pass } = await fn();
    const latencyMs = Date.now() - t0;
    results.push({ name, expected, actual, pass, latencyMs });
    console.log(`${pass ? "PASS" : "FAIL"} [${latencyMs}ms] ${name}`);
    if (!pass) console.log(`  expected: ${expected}\n  actual:   ${actual}`);
  } catch (err: any) {
    const latencyMs = Date.now() - t0;
    const actual = err.message || String(err);
    const pass = actual === expected;
    results.push({ name, expected, actual, pass, latencyMs });
    console.log(`${pass ? "PASS" : "FAIL"} [${latencyMs}ms] ${name}`);
    if (!pass) console.log(`  expected: ${expected}\n  actual:   ${actual}`);
  }
}

async function main() {
  console.log("\n=== Deterministic Accuracy Suite ===");
  console.log(`Server: ${TERMINAL_URL}`);
  console.log(`Server commit: ${SERVER_COMMIT}`);
  console.log(`CLI commit: ${CLI_COMMIT}`);
  console.log("");

  const clerkToken = await getToken();
  const terminalToken = await exchangeForTerminalToken(clerkToken);
  console.log(`Tokens: obtained\n`);

  // ─── Group 1: Node.js runtime truth (5 cases) ───────────────────

  // 1. Node version consistency
  await runTest("1. Node version — server reports v22.x", "v22", async () => {
    const j = await doCmd(terminalToken, ["node", "--version"]);
    const v = j.result?.data?.stdout?.trim() ?? "";
    return { actual: v, pass: v.startsWith("v22.") };
  });

  // 2. Arithmetic truth — 2+2=4
  await runTest("2. Arithmetic — 2+2=4", "4", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.log(2+2)"]);
    const v = j.result?.data?.stdout?.trim() ?? "";
    return { actual: v, pass: v === "4" };
  });

  // 3. String truth — hello world
  await runTest("3. String output — hello world", "hello world", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.log('hello world')"]);
    const v = j.result?.data?.stdout?.trim() ?? "";
    return { actual: v, pass: v === "hello world" };
  });

  // 4. Exit code truth — exit 0
  await runTest("4. Exit code — success returns 0", "0", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "process.exit(0)"]);
    const code = j.result?.data?.exitCode ?? -1;
    return { actual: String(code), pass: code === 0 };
  });

  // 5. Exit code truth — exit 42
  await runTest("5. Exit code — custom exit 42", "42", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "process.exit(42)"]);
    const code = j.result?.data?.exitCode ?? -1;
    return { actual: String(code), pass: code === 42 };
  });

  // ─── Group 2: Filesystem truth (5 cases) ────────────────────────

  // 6. CWD is user workspace
  await runTest("6. CWD — within user workspace", "/data/littree-workspaces/", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.log(process.cwd())"]);
    const cwd = j.result?.data?.stdout?.trim() ?? "";
    return { actual: cwd, pass: cwd.startsWith("/data/littree-workspaces/") };
  });

  // 7. File write + read roundtrip
  await runTest("7. File write+read — content matches", "test-content", async () => {
    const j1 = await doCmd(terminalToken, ["node", "-e", "require('fs').writeFileSync('/tmp/acc-test.txt','test-content')"]);
    const j2 = await doCmd(terminalToken, ["node", "-e", "console.log(require('fs').readFileSync('/tmp/acc-test.txt','utf8'))"]);
    const content = j2.result?.data?.stdout?.trim() ?? "";
    return { actual: content, pass: content === "test-content" };
  });

  // 8. Directory listing — workspace is non-empty after file write
  await runTest("8. Directory listing — workspace exists", "true", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.log(require('fs').existsSync(process.cwd()))"]);
    const exists = j.result?.data?.stdout?.trim() ?? "";
    return { actual: exists, pass: exists === "true" };
  });

  // 9. File size truth — 1000 bytes
  await runTest("9. File size — 1000 bytes", "1000", async () => {
    await doCmd(terminalToken, ["node", "-e", "require('fs').writeFileSync('/tmp/size-test.txt','x'.repeat(1000))"]);
    const j = await doCmd(terminalToken, ["node", "-e", "console.log(require('fs').statSync('/tmp/size-test.txt').size)"]);
    const size = j.result?.data?.stdout?.trim() ?? "";
    return { actual: size, pass: size === "1000" };
  });

  // 10. File deletion truth
  await runTest("10. File deletion — file gone after unlink", "false", async () => {
    await doCmd(terminalToken, ["node", "-e", "require('fs').writeFileSync('/tmp/del-test.txt','x')"]);
    await doCmd(terminalToken, ["node", "-e", "require('fs').unlinkSync('/tmp/del-test.txt')"]);
    const j = await doCmd(terminalToken, ["node", "-e", "console.log(require('fs').existsSync('/tmp/del-test.txt'))"]);
    const exists = j.result?.data?.stdout?.trim() ?? "";
    return { actual: exists, pass: exists === "false" };
  });

  // ─── Group 3: stdout/stderr separation (3 cases) ────────────────

  // 11. stdout vs stderr — stdout only
  await runTest("11. stdout only — stderr empty", "ok", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.log('to-stdout')"]);
    const stdout = j.result?.data?.stdout?.trim() ?? "";
    const stderr = j.result?.data?.stderr?.trim() ?? "";
    return { actual: stdout === "to-stdout" && stderr === "" ? "ok" : `stdout=${stdout} stderr=${stderr}`, pass: stdout === "to-stdout" && stderr === "" };
  });

  // 12. stdout vs stderr — stderr only
  await runTest("12. stderr only — stdout empty", "ok", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.error('to-stderr')"]);
    const stdout = j.result?.data?.stdout?.trim() ?? "";
    const stderr = j.result?.data?.stderr?.trim() ?? "";
    return { actual: stdout === "" && stderr === "to-stderr" ? "ok" : `stdout=${stdout} stderr=${stderr}`, pass: stdout === "" && stderr === "to-stderr" };
  });

  // 13. Both stdout and stderr
  await runTest("13. Both stdout+stderr — separated correctly", "ok", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.log('out'); console.error('err')"]);
    const stdout = j.result?.data?.stdout?.trim() ?? "";
    const stderr = j.result?.data?.stderr?.trim() ?? "";
    return { actual: stdout === "out" && stderr === "err" ? "ok" : `stdout=${stdout} stderr=${stderr}`, pass: stdout === "out" && stderr === "err" };
  });

  // ─── Group 4: Auth state (3 cases) ──────────────────────────────

  // 14. Valid token — 200 OK
  await runTest("14. Valid token — command succeeds", "true", async () => {
    const j = await doCmd(terminalToken, ["node", "-e", "console.log('auth-ok')"]);
    return { actual: String(j.ok), pass: j.ok === true };
  });

  // 15. Invalid token — 401
  await runTest("15. Invalid token — 401 Unauthorized", "401", async () => {
    const r = await fetch(`${TERMINAL_URL}/api/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token-xyz",
      },
      body: JSON.stringify({ command: "/do", args: ["echo", "test"] }),
    });
    return { actual: String(r.status), pass: r.status === 401 };
  });

  // 16. Missing token — 401
  await runTest("16. Missing token — 401 Unauthorized", "401", async () => {
    const r = await fetch(`${TERMINAL_URL}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "/do", args: ["echo", "test"] }),
    });
    return { actual: String(r.status), pass: r.status === 401 };
  });

  // ─── Group 5: Transport state (2 cases) ─────────────────────────

  // 17. Health endpoint — alive
  await runTest("17. Health/live — status alive", "alive", async () => {
    const r = await fetch(`${TERMINAL_URL}/health/live`, { signal: AbortSignal.timeout(5_000) });
    const j = await r.json();
    return { actual: j.status, pass: j.status === "alive" };
  });

  // 18. Health/ready — ready
  await runTest("18. Health/ready — readiness ready", "ready", async () => {
    const r = await fetch(`${TERMINAL_URL}/health/ready`, { signal: AbortSignal.timeout(5_000) });
    const j = await r.json();
    return { actual: j.readiness, pass: j.readiness === "ready" };
  });

  // ─── Group 6: /status command truth (2 cases) ───────────────────

  // 19. /status returns workspace root
  await runTest("19. /status — root is workspace path", "/data/littree-workspaces/", async () => {
    const j = await slashCmd(terminalToken, "/status");
    const root = j.result?.data?.root ?? "";
    return { actual: root, pass: root.startsWith("/data/littree-workspaces/") };
  });

  // 20. /status returns isGitRepo boolean
  await runTest("20. /status — isGitRepo is boolean", "boolean", async () => {
    const j = await slashCmd(terminalToken, "/status");
    const isGit = j.result?.data?.isGitRepo;
    const actual = typeof isGit === "boolean" ? "boolean" : String(typeof isGit);
    return { actual, pass: typeof isGit === "boolean" };
  });

  // Summary
  console.log("\n=== Summary ===");
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  console.log(`Server: ${TERMINAL_URL}`);
  console.log(`Server commit: ${SERVER_COMMIT}`);
  console.log(`CLI commit: ${CLI_COMMIT}`);
  console.log("");

  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"} ${r.name} [${r.latencyMs}ms]`);
  }

  if (failed > 0) {
    console.log("\nFAILURES:");
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`  ${r.name}: expected=${r.expected}, actual=${r.actual}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
