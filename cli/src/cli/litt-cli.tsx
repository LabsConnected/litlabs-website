import process from "node:process";
import path from "node:path";
import { Command } from "commander";
import { render } from "ink";
import { detectGitInfo } from "./git.js";
import { resolveProject } from "./project.js";
import { loadConfig, getConfigPath } from "./config.js";
import {
  resolveAuth,
  saveToken,
  clearToken,
  hasStoredToken,
  interactiveLogin,
} from "./auth.js";
import { detectTerminalCapability } from "./terminal.js";
import { runLiTTStream } from "./api-client.js";
import { Repl } from "./repl.js";
import type { RuntimeContext } from "./types.js";
import { CLI_NAME, CLI_VERSION } from "./types.js";

const program = new Command();

function buildRuntimeContext(cwd: string): RuntimeContext {
  const git = detectGitInfo(cwd);
  const project = resolveProject(cwd, git.remote);
  return { cwd, git, project, terminalAvailable: false, writeAccess: true };
}

async function ensureAuth(): Promise<boolean> {
  const auth = resolveAuth();
  if (auth.isAuthenticated) return true;

  console.error(
    `\n${CLI_NAME} needs authentication.\n` +
      `Run: litt login\n` +
      `Or set LITT_CODE_TOKEN or LITT_CODE_CLERK_TOKEN.\n`,
  );
  return false;
}

async function runRepl(cwd: string, model?: string, provider?: string) {
  const ctx = buildRuntimeContext(cwd);
  const terminal = await detectTerminalCapability(ctx);
  const runtimeContext = { ...ctx, terminalAvailable: terminal.available };
  render(
    <Repl
      cwd={cwd}
      runtimeContext={runtimeContext}
      model={model}
      provider={provider}
      onExit={() => process.exit(0)}
    />,
  );
}

program
  .name(CLI_NAME)
  .description("AI development agent for your terminal")
  .version(CLI_VERSION)
  .option("--cwd <directory>", "Working directory", process.cwd())
  .option("-m, --model <model>", "Model to use (e.g. gemini-2.5-pro)")
  .option("-p, --provider <provider>", "Provider to use (e.g. gemini)");

program
  .command("chat")
  .description("Start an interactive chat session")
  .option("--cwd <directory>", "Working directory", process.cwd())
  .option("-m, --model <model>", "Model to use")
  .option("-p, --provider <provider>", "Provider to use")
  .action(async (options) => {
    const cwd = path.resolve(options.cwd || process.cwd());
    if (!(await ensureAuth())) process.exit(1);
    const config = loadConfig();
    await runRepl(cwd, options.model || config.model, options.provider);
  });

program
  .command("login")
  .description("Authenticate with LiTTree")
  .option("--token <token>", "Provide session token directly")
  .action(async (options) => {
    if (options.token) {
      saveToken(options.token);
      console.log("✅ Token saved.");
      return;
    }
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net";
    const token = await interactiveLogin(baseUrl);
    if (token) {
      console.log("✅ Logged in.");
    } else {
      console.log("❌ No token provided.");
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    clearToken();
    console.log("✅ Logged out.");
  });

program
  .command("status")
  .description("Show auth and environment status")
  .action(() => {
    const auth = resolveAuth();
    const config = loadConfig();
    console.log(`\n${CLI_NAME} v${CLI_VERSION}`);
    console.log(`\nAuth:`);
    console.log(`  authenticated: ${auth.isAuthenticated}`);
    console.log(`  userId: ${auth.userId ?? "none"}`);
    console.log(`  hasStoredToken: ${hasStoredToken()}`);
    console.log(`\nConfig:`);
    console.log(`  model: ${config.model ?? "auto"}`);
    console.log(`  configPath: ${getConfigPath()}`);
    console.log(`\nEnv:`);
    console.log(`  NEXT_PUBLIC_API_BASE: ${process.env.NEXT_PUBLIC_API_BASE ?? "(unset)"}`);
    console.log(`  LITT_CODE_API_URL: ${process.env.LITT_CODE_API_URL ?? "(unset)"}`);
    console.log("");
  });

program
  .argument("[prompt]", "One-shot prompt to run without entering REPL")
  .action(async (prompt, options) => {
    const cwd = path.resolve(options.cwd || process.cwd());
    if (!(await ensureAuth())) process.exit(1);
    const config = loadConfig();
    const model = options.model || config.model;
    const provider = options.provider;

    const ctx = buildRuntimeContext(cwd);
    const terminal = await detectTerminalCapability(ctx);
    const runtimeContext = { ...ctx, terminalAvailable: terminal.available };

    if (prompt) {
      const stream = runLiTTStream({
        message: prompt,
        model,
        provider,
        runtimeContext: {
          cwd: runtimeContext.cwd,
          git: runtimeContext.git,
          project: runtimeContext.project,
          terminalAvailable: runtimeContext.terminalAvailable,
          writeAccess: runtimeContext.writeAccess,
        },
      });
      for await (const event of stream) {
        if (event.type === "text" && event.text) {
          process.stdout.write(event.text);
        }
      }
      process.stdout.write("\n");
      return;
    }

    await runRepl(cwd, model, provider);
  });

await program.parseAsync(process.argv);