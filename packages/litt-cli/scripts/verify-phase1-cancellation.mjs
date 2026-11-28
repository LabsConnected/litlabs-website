import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const worker = `const { spawn } = require("node:child_process");
const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio:"ignore",windowsHide:true});
console.log("LITT_FIXTURE_PIDS " + process.pid + " " + child.pid);
setInterval(()=>{},1000);`;

async function verify(kind) {
  const cwd = await mkdtemp(join(tmpdir(), "litt-phase1-"));
  const model = "qwen3:4b-instruct";
  let socketClosed = false;
  let modelRequests = 0;
  let pids = [];
  const server = createServer((req, res) => {
    req.resume();
    const json = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/tags") return json({ models: [{ name: model }] });
    if (req.url === "/api/ps") return json({ models: [{ name: model }] });
    if (req.url === "/api/show") return json({ capabilities: ["completion", "tools"] });
    if (req.url === "/v1/chat/completions") {
      modelRequests++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const delta = kind === "process"
        ? { tool_calls: [{ index: 0, function: { name: "project_build", arguments: "{}" } }] }
        : { content: "Started" };
      res.write(`data: ${JSON.stringify({ model, choices: [{ delta }] })}\n\n`);
      if (kind === "process") return res.end("data: [DONE]\n\n");
      res.once("close", () => { socketClosed = true; });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  let child;
  try {
    await writeFile(join(cwd, "package.json"), JSON.stringify({
      name: "litt-phase1-cancellation-fixture", scripts: { build: "node worker.cjs" },
    }));
    await writeFile(join(cwd, "worker.cjs"), worker);
    // Windows Node cannot send a catchable POSIX SIGINT to another process.
    // Deliver the event in the child over IPC. On Linux use the OS signal.
    const preload = 'data:text/javascript,process.on("message",m=>{if(m==="interrupt")process.emit("SIGINT","SIGINT")})';
    child = fork(fileURLToPath(new URL("../dist/index.js", import.meta.url)), [
      "ask", "--jsonl", "--mode", "auto",
      kind === "process" ? "Run the fixture project build." : "Reply with exactly: Started",
    ], {
      cwd,
      execArgv: process.platform === "win32" ? ["--import", preload] : [],
      silent: true,
      env: {
        ...process.env,
        LITT_CWD: cwd, LITT_TARGET_OVERRIDE: "local", LITT_MODEL: model,
        LITT_ASK_TIMEOUT_MS: "15000",
        LITT_OLLAMA_URL: `http://127.0.0.1:${server.address().port}`,
      },
    });
    let stderr = "";
    let buffer = "";
    let cancelledAt = 0;
    const events = [];
    child.stderr.setEncoding("utf8").on("data", (text) => { stderr += text; });
    child.stdout.setEncoding("utf8").on("data", (text) => {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const event = JSON.parse(line);
        events.push(event);
        if (cancelledAt) continue;
        const pidLine = event.type === "tool.output" && /LITT_FIXTURE_PIDS (\d+) (\d+)/.exec(event.text);
        if (pidLine) pids = pidLine.slice(1).map(Number);
        if ((kind === "http" && event.type === "model.delta") || pids.length === 2) {
          cancelledAt = Date.now();
          if (process.platform === "win32") child.send("interrupt");
          else child.kill("SIGINT");
        }
      }
    });
    const exit = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Fixture timed out: ${stderr}`)); }, 25000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); resolve(code); });
    });
    const terminal = events.filter(({ type }) => type === "run.result");
    assert.equal(exit, 130, JSON.stringify({ stderr, events }));
    assert.equal(modelRequests, 1);
    assert.equal(terminal.length, 1);
    assert.equal(terminal[0].termination, "cancelled");
    assert.equal(events.at(-1), terminal[0]);
    assert.ok(cancelledAt > 0 && Date.now() - cancelledAt < 5000);
    if (kind === "http") {
      for (let i = 0; !socketClosed && i < 10; i++) await delay(50);
      assert.ok(socketClosed, "HTTP response socket stayed open");
    } else {
      assert.equal(pids.length, 2);
      for (const pid of pids) {
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, `PID ${pid} survived`);
      }
      assert.equal(events.find(({ type }) => type === "tool.result")?.status, "cancelled");
    }
    console.log(JSON.stringify({ kind, exit, modelRequests, socketClosed, pids, cancellationMs: Date.now() - cancelledAt }));
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const kind of process.argv.slice(2).length ? process.argv.slice(2) : ["http", "process"]) await verify(kind);
