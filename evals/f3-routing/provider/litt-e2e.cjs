/**
 * "litt-e2e" provider — real end-to-end LiTT CLI invocation.
 *
 * For every test case this:
 *   1. Creates a brand-new, empty scratch project directory (fresh git
 *      repo + minimal package.json) so no test can see another test's
 *      files.
 *   2. Runs the CANONICAL build output directly:
 *        node <repo>/packages/litt-cli/dist/index.js ask "<prompt>"
 *      (bypassing the `litt` shell function / ~/LiTT/bin/litt stale
 *      copy — see AGENTS.md "Do NOT use retired copies").
 *   3. Points it at PC Ollama (qwen3:4b-instruct-fast) for $0 inference.
 *   4. Snapshots the directory tree AFTER the run and diffs it against
 *      the known starting files (package.json, .git, .litt) to get the
 *      list of files LiTT actually persisted to disk.
 *
 * The returned `output` is a JSON string of real, observed facts —
 * never the model's own narration — so assertions can check genuine
 * file-creation evidence instead of trusting generated text.
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../");
const CLI_ENTRY = path.join(REPO_ROOT, "packages/litt-cli/dist/index.js");
const KNOWN_SEED_ENTRIES = new Set(["package.json", ".git", ".litt"]);

function listEntriesRecursive(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue; // never diff git internals
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...listEntriesRecursive(path.join(dir, entry.name), rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function makeSandbox(testId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `litt-f3-${testId}-`));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `f3-${testId}`, version: "0.0.0", private: true }, null, 2) + "\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

class LittE2EProvider {
  id() {
    return "litt-e2e";
  }

  async callApi(prompt, context) {
    const testId = (context?.vars?.id || "case").toString().replace(/[^a-z0-9-]/gi, "-");
    const sandbox = makeSandbox(testId);
    const before = new Set(listEntriesRecursive(sandbox));

    const timeoutMs = Number(process.env.LITT_E2E_TIMEOUT_MS || 150000);
    const result = spawnSync(
      process.execPath,
      [CLI_ENTRY, "ask", prompt],
      {
        cwd: sandbox,
        env: {
          ...process.env,
          LITT_LOCAL_ONLY: "1",
          LITT_OLLAMA_URL: process.env.LITT_OLLAMA_URL || "http://100.107.123.73:11434",
          LITT_MODEL: process.env.LITT_MODEL || "qwen3:4b-instruct-fast",
        },
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      },
    );

    const after = listEntriesRecursive(sandbox);
    const newFiles = after.filter((f) => !before.has(f) && !KNOWN_SEED_ENTRIES.has(f));

    const stdout = result.stdout || "";
    const toolCallMatches = [...stdout.matchAll(/Tool call:\s*(\S+)/g)].map((m) => m[1]);
    const terminationMatch = stdout.match(/Agent (completed|failed|cancelled|stopped[^\n(]*)/);

    return {
      output: JSON.stringify({
        sandbox,
        exitCode: result.status,
        timedOut: Boolean(result.signal),
        toolCalls: toolCallMatches,
        termination: terminationMatch ? terminationMatch[0] : null,
        newFiles,
        rawStdoutTail: stdout.slice(-4000),
        rawStderrTail: (result.stderr || "").slice(-2000),
      }),
    };
  }
}

module.exports = LittE2EProvider;
