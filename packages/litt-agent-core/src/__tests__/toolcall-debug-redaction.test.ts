/**
 * LITT_TOOLCALL_DEBUG secret hygiene — regression tests.
 *
 * The debug path dumps raw model-emitted tool arguments to a file.
 * Tool arguments routinely carry credentials (API keys in command
 * strings, bearer tokens in headers, secrets in file content), so the
 * log must apply the executor's redactSecrets() plus wholesale masking
 * of values under credential-sounding keys — without changing what the
 * tool itself receives or whether it runs.
 *
 * All secrets below are synthetic shapes matching the redaction
 * patterns; none are real credentials.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAgentLoop, redactToolCallInputs } from "../agent-loop.js";
import { ToolRegistry } from "../tools.js";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore } from "../state.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelResult,
  ModelStreamEvent,
  ToolDefinition,
  ToolEntry,
  ToolResult,
} from "../types.js";

// Synthetic credentials — shaped to trip each redaction pattern.
const SK_TOKEN = "sk-live-FAKEKEY1234567890abcdef";       // sk- + 20+
const BEARER_TOKEN = "Bearer abcdefghij1234567890.tok";   // Bearer + 20+
const PASSWORD = "Hunter2!not-a-real-password";           // under a key name
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c";

function makeMockModel(responses: string[]): ModelProvider {
  let call = 0;
  return {
    async stream(
      _messages: ChatMessage[],
      emit: (event: ModelStreamEvent) => void,
    ): Promise<ModelResult> {
      const response = responses[Math.min(call, responses.length - 1)] ?? "";
      call++;
      emit({ type: "meta", provider: "mock", model: "mock-model", profile: "fast" });
      emit({ type: "delta", text: response });
      emit({
        type: "done",
        model: "mock-model",
        usage: { total_tokens: 1 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
      });
      return {
        content: response,
        model: "mock-model",
        provider: "mock",
        usage: { total_tokens: 1 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
        profile: "fast",
      };
    },
    async health(): Promise<number> {
      return 100;
    },
  };
}

function makeEchoRegistry(id: string, onRun: () => void): ToolRegistry {
  const def: ToolDefinition = {
    id,
    name: id.split(".").pop() ?? id,
    description: "Echo test tool",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        api_key: { type: "string" },
        command: { type: "string" },
        args: { type: "array" },
        env: { type: "object" },
        jwt: { type: "string" },
      },
      required: ["path"],
    },
    readOnly: true,
  };
  const entry: ToolEntry = {
    definition: def,
    handler: (async () => {
      onRun();
      return { status: "success", success: true, message: "echoed", data: {} } as ToolResult;
    }) as never,
    metadata: { projectScoped: false, mutating: false, readOnly: true },
  };
  return new ToolRegistry({ [id]: entry });
}

// ─── Unit: redactToolCallInputs ──────────────────────────────────────

test("values under credential-sounding keys are masked wholesale", () => {
  const out = redactToolCallInputs({
    path: "a.txt",
    api_key: "not-even-a-token-shape",
    password: PASSWORD,
    Authorization: BEARER_TOKEN,
    client_secret: "whatever",
    count: 3,
  }) as Record<string, unknown>;
  assert.equal(out.api_key, "[REDACTED]");
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.Authorization, "[REDACTED]");
  assert.equal(out.client_secret, "[REDACTED]");
  assert.equal(out.path, "a.txt");
  assert.equal(out.count, 3);
});

test("credential shapes inside ordinary string values are scrubbed", () => {
  const out = redactToolCallInputs({
    command: `curl -H "Authorization: ${BEARER_TOKEN}" https://api.example.com`,
  }) as Record<string, unknown>;
  const cmd = out.command as string;
  assert.ok(!cmd.includes(BEARER_TOKEN.slice(7)), "raw bearer token gone");
  assert.ok(cmd.includes("[REDACTED]"));
  assert.ok(cmd.includes("curl -H"), "non-secret command text kept");
});

test("bare tokens inside arrays and nested objects are scrubbed", () => {
  const out = redactToolCallInputs({
    args: ["deploy", SK_TOKEN, "--force"],
    env: { OPENAI_API_KEY: SK_TOKEN, plain: "visible" },
    jwt: JWT,
  }) as Record<string, unknown>;
  const args = out.args as string[];
  assert.equal(args[0], "deploy");
  assert.equal(args[1], "[REDACTED]");
  assert.equal(args[2], "--force");
  const env = out.env as Record<string, unknown>;
  assert.equal(env.OPENAI_API_KEY, "[REDACTED]", "sensitive nested key masked");
  assert.equal(env.plain, "visible");
  assert.equal(out.jwt, "[REDACTED]");
});

test("non-secret inputs pass through unchanged", () => {
  const input = { path: "src/index.ts", content: "hello world", lines: [1, 2], ok: true };
  assert.deepEqual(redactToolCallInputs(input), input);
});

// ─── E2E: the debug log file ─────────────────────────────────────────

describe("LITT_TOOLCALL_DEBUG log file", () => {
  test("secrets in tool-call inputs never reach the log; tool still runs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-dbg-"));
    const logFile = path.join(dir, "args.log");
    const DBG = "LITT_TOOLCALL_DEBUG";
    const DBGF = "LITT_TOOLCALL_DEBUG_FILE";
    const oldDbg = process.env[DBG];
    const oldFile = process.env[DBGF];
    process.env[DBG] = "1";
    process.env[DBGF] = logFile;
    try {
      let ran = false;
      const tools = makeEchoRegistry("test.echo", () => { ran = true; });
      const model = makeMockModel([
        "```tool_call\n" +
          JSON.stringify({
            tool: "test.echo",
            inputs: {
              path: "notes.txt",
              api_key: PASSWORD,
              command: `curl -H "Authorization: ${BEARER_TOKEN}" https://api.example.com`,
              args: ["deploy", SK_TOKEN],
              env: { nested_token: "tok_fakesecret123", plain: "ok" },
              jwt: JWT,
            },
          }) +
          "\n```",
        "done.",
      ]);
      const shell = new NodeShellExecutor(process.cwd());
      const store = new RuntimeStore(() => {});
      const result = await runAgentLoop("echo something", {
        model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
      });

      assert.ok(ran, "tool handler ran — functionality preserved");
      assert.ok(result.toolCalls.length >= 1, "tool call recorded");

      const log = fs.readFileSync(logFile, "utf8");
      assert.ok(log.length > 0, "debug log was written");
      for (const secret of [SK_TOKEN, PASSWORD, BEARER_TOKEN, JWT, "tok_fakesecret123"]) {
        assert.ok(!log.includes(secret), `log must not contain secret: ${secret.slice(0, 12)}…`);
      }
      assert.ok(log.includes("[REDACTED]"), "redaction markers present");
      assert.ok(log.includes("notes.txt"), "benign args kept for diagnosis");
      assert.ok(log.includes("curl -H"), "non-secret command text kept");
      assert.ok(log.includes('"plain":"ok"') || log.includes("ok"), "nested benign value kept");
    } finally {
      if (oldDbg === undefined) delete process.env[DBG];
      else process.env[DBG] = oldDbg;
      if (oldFile === undefined) delete process.env[DBGF];
      else process.env[DBGF] = oldFile;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("debug disabled → no log file is created at all", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-dbg-off-"));
    const logFile = path.join(dir, "args.log");
    const DBG = "LITT_TOOLCALL_DEBUG";
    const DBGF = "LITT_TOOLCALL_DEBUG_FILE";
    const oldDbg = process.env[DBG];
    const oldFile = process.env[DBGF];
    delete process.env[DBG];
    process.env[DBGF] = logFile; // even with a file path set, no env flag = no write
    try {
      let ran = false;
      const tools = makeEchoRegistry("test.echo", () => { ran = true; });
      const model = makeMockModel([
        '```tool_call\n{ "tool": "test.echo", "inputs": { "path": "notes.txt" } }\n```',
        "done.",
      ]);
      const shell = new NodeShellExecutor(process.cwd());
      const store = new RuntimeStore(() => {});
      await runAgentLoop("echo something", {
        model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
      });
      assert.ok(ran, "tool still executed with debug off");
      assert.ok(!fs.existsSync(logFile), "no log file when LITT_TOOLCALL_DEBUG unset");
    } finally {
      if (oldDbg === undefined) delete process.env[DBG];
      else process.env[DBG] = oldDbg;
      if (oldFile === undefined) delete process.env[DBGF];
      else process.env[DBGF] = oldFile;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
