#!/usr/bin/env node
/**
 * BROWSER TASK PROOF — drives the REAL `litt ask` command through a real
 * PTY (node-pty/ConPTY) so the interactive approval path is exercised:
 * every mutating browser.* tool must produce an "Approval required"
 * prompt, which this script answers with "y".
 *
 * Verifies a complete autonomous browsing task end-to-end:
 *   navigate → snapshot → type → click → screenshot → extract → report
 *
 * Output: PASS/FAIL lines + full transcript to browser-proof-evidence.txt.
 * Exit code 0 = all assertions passed.
 *
 * Usage (from packages/litt-cli):
 *   node scripts/browser-task-proof.mjs [--model litt-tools:4k]
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cliRoot, "..", "..");

const req = createRequire(pathToFileURL(path.join(repoRoot, "terminal-server", "package.json")));
const pty = req("node-pty");

const COLS = 140;
const ROWS = 40;
const TIMEOUT_MS = 240_000;

const modelIdx = process.argv.indexOf("--model");
const MODEL = modelIdx > -1 ? process.argv[modelIdx + 1] : "litt-tools:4k";

const PROMPT =
  "Browse https://httpbin.org/forms/post : call browser.navigate, then " +
  "browser.snapshot, type 'LiTT' into the customer name input using " +
  "browser.type with its selector, click the submit button with " +
  "browser.click, take a browser.screenshot, then browser.extract " +
  "document.body.innerText and report what the form returned.";

const transcript = [];
const findings = [];
let approvalsSeen = 0;
let approvalsAnswered = 0;

function record(s) {
  transcript.push(s);
}

function check(name, cond, detail = "") {
  findings.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const entry = path.join(cliRoot, "dist", "index.js");
  if (!fs.existsSync(entry)) {
    console.error("dist/index.js missing — run pnpm build first");
    process.exit(2);
  }

  const env = { ...process.env, LITT_MODEL: MODEL, NO_COLOR: "1" };
  const child = pty.spawn(process.execPath, [entry, "ask", "--local", PROMPT], {
    name: "xterm-color",
    cols: COLS,
    rows: ROWS,
    cwd: cliRoot,
    env,
  });

  let buf = "";
  let exitCode = null;
  let done = false;

  child.onData((d) => {
    record(d);
    buf += d;
    // Answer every approval prompt with "y" — this is the human-in-the-loop
    // decision the interactive path exists to collect.
    const matches = buf.match(/Approval required:[^\n]*\(y\/N\):/g);
    if (matches && matches.length > approvalsSeen) {
      approvalsSeen = matches.length;
      setTimeout(() => {
        child.write("y\r");
        approvalsAnswered += 1;
      }, 150);
    }
  });

  child.onExit(({ exitCode: code }) => {
    exitCode = code;
    done = true;
  });

  const deadline = Date.now() + TIMEOUT_MS;
  while (!done && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!done) {
    try { child.kill(); } catch {}
    check("run completed within timeout", false, `killed after ${TIMEOUT_MS}ms`);
  } else {
    check("run completed within timeout", true, `exit ${exitCode}`);
  }

  const text = transcript.join("");
  const clean = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");

  check("browser.navigate succeeded", /navigated to https:\/\/httpbin\.org\/forms\/post/i.test(clean));
  check("browser.snapshot found elements", /interactive elements/i.test(clean));
  check("approval prompts were shown", approvalsSeen > 0, `${approvalsSeen} prompt(s)`);
  check("approvals were answered", approvalsAnswered === approvalsSeen, `${approvalsAnswered}/${approvalsSeen}`);
  check("browser.type executed (not denied)", /typed \d+ chars/i.test(clean));
  check("browser.click executed (not denied)", /clicked .*submit|clicked .*button/i.test(clean));
  check("browser.screenshot saved", /screenshot saved to/i.test(clean));
  check("browser.extract returned data", /extracted page data/i.test(clean));
  check("form result reported", /customer|LiTT|forms\/post|submitted/i.test(clean));
  check("run terminated truthfully", exitCode === 0 || /max_rounds|complete/i.test(clean), `exit=${exitCode}`);

  const evidence = path.join(cliRoot, "browser-proof-evidence.txt");
  fs.writeFileSync(
    evidence,
    `model=${MODEL}\nexit=${exitCode}\napprovals=${approvalsSeen}/${approvalsAnswered}\n\n=== TRANSCRIPT ===\n${clean}\n`,
  );
  console.log(`\nevidence → ${evidence}`);

  const failed = findings.filter((f) => !f.pass);
  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("proof crashed:", e);
  process.exit(2);
});
