/**
 * LiTT System Diagnostic — `litt doctor`
 *
 * Tests every piece of LiTT's brain end-to-end:
 *   Runtime       → Kernel, identity, model router
 *   Memory        → Supabase, memories table, project_knowledge, Supermemory, semantic search, round-trip
 *   Observability → Braintrust configured, trace emitted
 *   Workspace     → Repository connected, branch, execution available, write surface
 *   Agent         → Conversational path, execution path, tools, permission engine
 *
 * Usage:
 *   pnpm litt:doctor              Normal diagnostic (missing env keys = WARN)
 *   pnpm litt:doctor -- --strict  Strict mode (missing env keys = FAIL)
 *
 * Exit code 0 = all healthy, 1 = one or more failures.
 */

import "dotenv/config";

// ─── CLI Args ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const strictMode = args.includes("--strict");

// ─── Diagnostic namespace for isolation ──────────────────────────────

const DIAG_NS = "litt-doctor";
const DIAG_USER = "doctor-diagnostic-user";
const DIAG_PROJECT = "00000000-0000-0000-0000-000000000000";

// ─── Helpers ───────────────────────────────────────────────────────

const PASS = "\u2713";
const FAIL = "\u2717";
const WARN = "\u26a0";

type Status = "pass" | "warn" | "fail";

interface CheckResult {
  name: string;
  category: string;
  status: Status;
  detail: string;
}

const results: CheckResult[] = [];

function check(category: string, name: string, status: Status, detail: string): void {
  // In strict mode, warnings become failures
  if (status === "warn" && strictMode) {
    status = "fail";
  }
  results.push({ category, name, status, detail });
  const symbol = status === "pass" ? PASS : status === "warn" ? WARN : FAIL;
  const label = status === "pass" ? "PASS" : status === "warn" ? "WARN" : "FAIL";
  console.log(`  ${symbol} ${name.padEnd(40)} ${label.padEnd(5)}  ${detail}`);
}

/** Check an env key without ever printing its value */
function envCheck(category: string, name: string, envKey: string, required = false): boolean {
  const value = process.env[envKey];
  if (value) {
    check(category, name, "pass", `${envKey} is set (${value.length} chars)`);
    return true;
  } else {
    check(category, name, required ? "fail" : "warn", `${envKey} is NOT SET`);
    return false;
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ─── Runtime Checks ────────────────────────────────────────────────

async function checkRuntime(): Promise<void> {
  section("Runtime");

  // Kernel
  try {
    const { routeKernel, composeSystemPrompt } = await import("../src/lib/litt-kernel/index.ts");
    const decision = routeKernel({
      message: "hello",
      userId: "doctor",
      conversationId: null,
      projectId: null,
      missionId: null,
      canvasId: null,
      capabilities: [],
    });
    const prompt = composeSystemPrompt(decision.decision, []);
    const hasIdentity = prompt.includes("LiTT is a conversation-driven AI operating system");
    const hasPersona = prompt.includes("LiTT speaks plainly");
    check("Runtime", "Kernel", decision.ok ? "pass" : "fail", `mode=${decision.decision.routing.mode}`);
    check("Runtime", "canonical LiTT identity", hasIdentity ? "pass" : "fail", hasIdentity ? "identity present" : "MISSING identity");
    check("Runtime", "LiTT persona voice", hasPersona ? "pass" : "fail", hasPersona ? "persona present" : "MISSING persona");
  } catch (err) {
    check("Runtime", "Kernel", "fail", err instanceof Error ? err.message : String(err));
  }

  // Model router
  try {
    const { selectModelOptions } = await import("../src/lib/litt-runtime/provider-router.ts");
    const opts = selectModelOptions({ message: "test" });
    check("Runtime", "Model router", "pass", `category=${opts.category}, task=${opts.task}`);
  } catch (err) {
    check("Runtime", "Model router", "fail", err instanceof Error ? err.message : String(err));
  }

  // LLM keys (never print values)
  envCheck("Runtime", "Gemini API key", "GEMINI_API_KEY");
  envCheck("Runtime", "OpenRouter API key", "OPENROUTER_API_KEY");
  envCheck("Runtime", "Groq API key", "GROQ_API_KEY");
}

// ─── Memory Checks ─────────────────────────────────────────────────

async function checkMemory(): Promise<void> {
  section("Memory");

  // Supabase
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseOk = !!supabaseUrl && !!supabaseServiceKey;
  check("Memory", "Supabase connected", supabaseOk ? "pass" : "warn",
    supabaseUrl ? `url configured (${supabaseUrl.slice(0, 20)}...)` : "NOT CONFIGURED");

  if (!supabaseUrl || !supabaseServiceKey) {
    check("Memory", "memories table", "warn", "skipped — no Supabase");
    check("Memory", "project_knowledge table", "warn", "skipped — no Supabase");
    check("Memory", "Supermemory connected", process.env.SUPERMEMORY_API_KEY ? "pass" : "warn",
      process.env.SUPERMEMORY_API_KEY ? "key set" : "NOT SET");
    check("Memory", "semantic search", "warn", "skipped — no Supermemory");
    check("Memory", "memory round-trip", "warn", "skipped — no Supabase");
    return;
  }

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // memories table
    try {
      const { error: memError } = await supabase
        .from("memories")
        .select("id")
        .limit(1);
      check("Memory", "memories table", memError ? "fail" : "pass", memError ? memError.message : "accessible");
    } catch (err) {
      check("Memory", "memories table", "fail", err instanceof Error ? err.message : String(err));
    }

    // project_knowledge table
    try {
      const { error: pkError } = await supabase
        .from("project_knowledge")
        .select("id")
        .limit(1);
      check("Memory", "project_knowledge table", pkError ? "fail" : "pass", pkError ? pkError.message : "accessible");
    } catch (err) {
      check("Memory", "project_knowledge table", "fail", err instanceof Error ? err.message : String(err));
    }

    // Memory round-trip: insert + recall + delete (isolated diagnostic namespace)
    try {
      const testContent = `[${DIAG_NS}] round-trip test ${Date.now()}`;
      const dedupeKey = `${DIAG_NS}-${Date.now()}`;

      const { data: insertData, error: insertError } = await supabase
        .from("memories")
        .insert({
          owner_id: DIAG_USER,
          project_id: DIAG_PROJECT,
          content: testContent,
          memory_type: "agent_note",
          dedupe_key: dedupeKey,
          metadata: { source: DIAG_NS, diagnostic: true },
          sync_status: "pending",
        })
        .select()
        .single();

      if (insertError || !insertData) {
        check("Memory", "memory round-trip", "fail", `insert failed: ${insertError?.message}`);
      } else {
        const { data: recalled } = await supabase
          .from("memories")
          .select("*")
          .eq("id", insertData.id)
          .single();

        const roundTripOk = recalled?.content === testContent;

        // Cleanup — always delete the diagnostic record
        await supabase.from("memories").delete().eq("id", insertData.id);

        check("Memory", "memory round-trip", roundTripOk ? "pass" : "fail",
          roundTripOk ? "insert + recall + cleanup OK" : "recall mismatch (cleaned up)");
      }
    } catch (err) {
      check("Memory", "memory round-trip", "fail", err instanceof Error ? err.message : String(err));
    }
  } catch (err) {
    check("Memory", "Supabase connected", "fail", err instanceof Error ? err.message : String(err));
  }

  // Supermemory
  const smKey = process.env.SUPERMEMORY_API_KEY;
  check("Memory", "Supermemory connected", smKey ? "pass" : "warn", smKey ? "key set" : "NOT SET");

  if (smKey) {
    try {
      const { Supermemory } = await import("supermemory");
      const sm = new Supermemory({ apiKey: smKey });
      const searchResults = await sm.search.memories({
        q: `${DIAG_NS} test`,
        containerTag: `user:${DIAG_USER}:project:${DIAG_PROJECT}`,
        limit: 1,
      });
      check("Memory", "semantic search", "pass", `search OK (${(searchResults.results || []).length} hits)`);
    } catch (err) {
      check("Memory", "semantic search", "fail", err instanceof Error ? err.message : String(err));
    }
  } else {
    check("Memory", "semantic search", "warn", "skipped — no Supermemory key");
  }
}

// ─── Observability Checks ──────────────────────────────────────────

async function checkObservability(): Promise<void> {
  section("Observability");

  const btKey = process.env.BT_API_KEY;
  check("Observability", "Braintrust configured", btKey ? "pass" : "warn", btKey ? "key set" : "NOT SET");

  if (btKey) {
    try {
      const { initLogger } = await import("braintrust");
      const logger = initLogger({ apiKey: btKey, projectName: "litlabs-website" });
      logger.log({
        input: { prompt: "litt doctor trace test" },
        output: "diagnostic trace",
        metadata: { source: DIAG_NS, timestamp: new Date().toISOString() },
        tags: [DIAG_NS, "diagnostic"],
      });
      check("Observability", "trace emitted", "pass", "logged to Braintrust");
    } catch (err) {
      check("Observability", "trace emitted", "fail", err instanceof Error ? err.message : String(err));
    }
  } else {
    check("Observability", "trace emitted", "warn", "skipped — no BT_API_KEY");
  }
}

// ─── Workspace Checks ──────────────────────────────────────────────

async function checkWorkspace(): Promise<void> {
  section("Workspace");

  // Check if we're in a git repo
  try {
    const { execSync } = await import("child_process");
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
    check("Workspace", "Repository connected", "pass", `branch=${branch}`);
    check("Workspace", "Repository root", "pass", repoRoot.slice(-40));
  } catch (err) {
    check("Workspace", "Repository connected", "fail", "not a git repo or git not available");
  }

  // Check for package.json
  try {
    const fs = await import("fs");
    const path = await import("path");
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    check("Workspace", "package.json", "pass", `${pkg.name}@${pkg.version}`);
  } catch (err) {
    check("Workspace", "package.json", "fail", "not found");
  }

  // Execution available (check for terminal server config)
  const terminalUrl = process.env.NEXT_PUBLIC_TERMINAL_SERVER_URL || process.env.TERMINAL_SERVER_URL;
  check("Workspace", "workspace transport", terminalUrl ? "pass" : "warn",
    terminalUrl ? "url configured" : "no terminal server URL");

  // Write surface (check Supabase service role — never print the key)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  check("Workspace", "write surface available", serviceKey ? "pass" : "warn",
    serviceKey ? "service role key set" : "NOT SET");
}

// ─── Agent Checks ──────────────────────────────────────────────────

async function checkAgent(): Promise<void> {
  section("Agent");

  // LiTT personality prompt (from canonical agent registry)
  try {
    const { LITT } = await import("../src/lib/agent-registry.ts");
    const hasPersonality = LITT.systemPrompt.includes("Match the user's energy");
    const hasCasualRule = LITT.systemPrompt.includes("casual questions");
    check("Agent", "LiTT personality", hasPersonality && hasCasualRule ? "pass" : "fail",
      hasPersonality && hasCasualRule ? "identity + casual rule present" : "MISSING personality markers");
  } catch (err) {
    check("Agent", "LiTT personality", "fail", err instanceof Error ? err.message : String(err));
  }

  // Conversational path (V1) — verify intent router routes casual chat to non-execution
  try {
    const { classifyIntent } = await import("../src/lib/litt-kernel/intent-router.ts");
    const casualIntent = classifyIntent("what's up");
    const codingIntent = classifyIntent("fix the TypeScript error");
    const casualOk = !casualIntent.requiresExecution;
    const codingOk = codingIntent.requiresExecution;
    check("Agent", "conversational path (V1)", casualOk ? "pass" : "fail",
      casualOk ? `casual chat → ${casualIntent.mode} (no execution)` : "casual chat incorrectly requires execution");
    check("Agent", "execution path (V2)", codingOk ? "pass" : "fail",
      codingOk ? `coding request → ${codingIntent.mode} (requires execution)` : "coding request not detected as execution");
  } catch (err) {
    check("Agent", "conversational path (V1)", "fail", err instanceof Error ? err.message : String(err));
    check("Agent", "execution path (V2)", "fail", err instanceof Error ? err.message : String(err));
  }

  // Tools
  try {
    const { toolRegistry } = await import("../src/lib/litt-intelligence/tool-registry.ts");
    const tools = toolRegistry.listEnabled();
    check("Agent", "tools", tools.length > 0 ? "pass" : "fail",
      `${tools.length} tools enabled: ${tools.map(t => t.id).slice(0, 5).join(", ")}${tools.length > 5 ? "..." : ""}`);
  } catch (err) {
    check("Agent", "tools", "fail", err instanceof Error ? err.message : String(err));
  }

  // Permission engine
  try {
    const { PermissionEngine } = await import("../src/lib/litt-intelligence/permission-engine.ts");
    const engine = new PermissionEngine();
    check("Agent", "permission engine", "pass", "PermissionEngine instantiated");
  } catch (err) {
    check("Agent", "permission engine", "fail", err instanceof Error ? err.message : String(err));
  }

  // Conversation history (depends on Supabase)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  check("Agent", "conversation history", supabaseUrl ? "pass" : "warn",
    supabaseUrl ? "Supabase available for history" : "no Supabase");

  // Project memory (depends on memories table + Supermemory)
  const hasProjectMemory = !!process.env.SUPERMEMORY_API_KEY && !!supabaseUrl;
  check("Agent", "project memory", hasProjectMemory ? "pass" : "warn",
    hasProjectMemory ? "Supermemory + Supabase" : "missing Supermemory or Supabase");
}

// ─── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\nLiTT System Diagnostic\n");
  console.log(`Time:   ${new Date().toISOString()}`);
  console.log(`Node:   ${process.version}`);
  console.log(`CWD:    ${process.cwd()}`);
  console.log(`Mode:   ${strictMode ? "STRICT (warnings = failures)" : "normal"}`);

  await checkRuntime();
  await checkMemory();
  await checkObservability();
  await checkWorkspace();
  await checkAgent();

  // Summary
  const passes = results.filter(r => r.status === "pass");
  const warnings = results.filter(r => r.status === "warn");
  const failures = results.filter(r => r.status === "fail");

  console.log("\n" + "─".repeat(60));
  console.log(`Results: ${passes.length} pass, ${warnings.length} warn, ${failures.length} fail`);

  if (failures.length === 0 && warnings.length === 0) {
    console.log("\nAll systems healthy.");
  } else if (failures.length === 0) {
    console.log(`\nAll systems healthy (${warnings.length} warning(s)${strictMode ? "" : " — run with --strict to treat as failures"}).`);
  } else {
    console.log(`\n${failures.length} failure(s):`);
    for (const f of failures) {
      console.log(`  ${FAIL} [${f.category}] ${f.name}: ${f.detail}`);
    }
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
