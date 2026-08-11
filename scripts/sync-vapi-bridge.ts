#!/usr/bin/env tsx
/**
 * pnpm sync:vapi-bridge [--dry-run]
 *
 * Configures the Vapi assistant to use the LiTT Voice Bridge architecture:
 *
 *   1. Sets the assistant's serverUrl to POST /api/vapi/events (call lifecycle)
 *   2. Configures a Custom LLM model that routes to POST /api/vapi/turn
 *   3. Removes individual tool IDs (get_active_project, read_file, etc.)
 *      since the LiTT Runtime handles all tool execution server-side
 *
 * After this, the flow is:
 *   Phone → Vapi → /api/vapi/events (call start, resolve caller)
 *          → Vapi sends transcript to /api/vapi/turn
 *          → runLiTTForVoice() processes it (same brain as Studio)
 *          → Response text returned for Vapi TTS
 *
 * Required env:
 *   VAPI_API_KEY
 *   LITTLABS_VAPI_TOOL_TOKEN
 *
 * Optional env:
 *   VAPI_ASSISTANT_ID — default: ef18583c-3538-4025-ad9f-2114d745525e (LiTT)
 *
 * This script never prints secret values.
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// ─── Project root + env ─────────────────────────────────────────

function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, "..");
}

const root = findProjectRoot();
const envLocal = path.join(root, ".env.local");
if (fs.existsSync(envLocal)) dotenv.config({ path: envLocal });
else dotenv.config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const TOOL_TOKEN = process.env.LITTLABS_VAPI_TOOL_TOKEN;
const ASSISTANT_ID =
  process.env.VAPI_ASSISTANT_ID ?? "ef18583c-3538-4025-ad9f-2114d745525e";

const BASE_URL = process.env.VAPI_BRIDGE_BASE_URL ?? "https://litlabs.net";
const EVENTS_URL = `${BASE_URL}/api/vapi/events`;
const TURN_URL = `${BASE_URL}/api/vapi/turn`;

const VAPI_BASE = "https://api.vapi.ai";
const DRY_RUN = process.argv.includes("--dry-run");

// ─── Vapi API helpers ───────────────────────────────────────────

async function vapiFetch(urlPath: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${VAPI_BASE}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VAPI_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep null */
  }
  if (!res.ok) {
    const msg = json?.error ?? json?.message ?? text ?? `HTTP ${res.status}`;
    throw new Error(`Vapi ${method} ${urlPath} failed: ${msg}`);
  }
  return json;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const missing: string[] = [];
  if (!VAPI_API_KEY) missing.push("VAPI_API_KEY");
  if (!TOOL_TOKEN || TOOL_TOKEN.length < 16) missing.push("LITTLABS_VAPI_TOOL_TOKEN (>=16 chars)");
  if (missing.length > 0) {
    console.error(`\nMissing required env: ${missing.join(", ")}.\n`);
    process.exit(1);
  }

  const authHeader = `Bearer ${TOOL_TOKEN}`;

  console.log(`\nLiTT Vapi Bridge Configuration`);
  console.log(`  assistant id    : ${ASSISTANT_ID}`);
  console.log(`  events URL      : ${EVENTS_URL}`);
  console.log(`  turn URL        : ${TURN_URL}`);
  console.log(`  auth            : Bearer <redacted>`);
  console.log(`  dry run         : ${DRY_RUN ? "yes" : "no"}\n`);

  // Build the assistant patch
  const patch = {
    // Server URL for call lifecycle events (status-update, end-of-call-report, assistant-request)
    serverUrl: EVENTS_URL,
    // Custom LLM: Vapi sends transcripts to our /api/vapi/turn endpoint
    // and speaks the response via TTS
    model: {
      provider: "custom-llm",
      url: TURN_URL,
      // Keep the existing model name for the Custom LLM
      model: "litt-voice",
      // Auth header for the Custom LLM endpoint
      headers: {
        Authorization: authHeader,
      },
      // No tools — the LiTT Runtime handles all tool execution server-side
      toolIds: [],
      // Minimal system message — the LiTT runtime injects full context per-call
      messages: [
        {
          role: "system",
          content:
            "You are LiTT, the AI assistant for LiTTree LabStudios. You handle voice calls and route them through the LiTT runtime.",
        },
      ],
    },
  };

  if (DRY_RUN) {
    const safe = JSON.parse(JSON.stringify(patch));
    if (safe.serverHeaders?.Authorization) safe.serverHeaders.Authorization = "Bearer <redacted>";
    if (safe.model?.headers?.Authorization) safe.model.headers.Authorization = "Bearer <redacted>";
    console.log("Dry run — would PATCH assistant with:\n");
    console.log(JSON.stringify(safe, null, 2));
    console.log("\nNo changes made. Run without --dry-run to apply.\n");
    return;
  }

  // Fetch current assistant to show what's changing
  const current = await vapiFetch(`/assistant/${ASSISTANT_ID}`, "GET");
  console.log("Current assistant config:");
  console.log(`  serverUrl       : ${current.serverUrl ?? "(none)"}`);
  console.log(`  model.provider  : ${current.model?.provider ?? "(none)"}`);
  console.log(`  model.url       : ${current.model?.url ?? "(none)"}`);
  console.log(`  model.toolIds   : ${current.model?.toolIds?.length ?? 0} tool(s)`);

  // Apply the patch
  console.log("\nPatching assistant...");
  const updated = await vapiFetch(`/assistant/${ASSISTANT_ID}`, "PATCH", patch);

  console.log("\nDone. Assistant updated:");
  console.log(`  serverUrl       : ${updated.serverUrl ?? EVENTS_URL}`);
  console.log(`  model.provider  : ${updated.model?.provider ?? "custom-llm"}`);
  console.log(`  model.url       : ${updated.model?.url ?? TURN_URL}`);
  console.log(`  model.toolIds   : ${updated.model?.toolIds?.length ?? 0} tool(s)`);

  console.log(
    `\nArchitecture is now: Phone → Vapi → /api/vapi/events (caller resolution) →` +
    ` /api/vapi/turn (runLiTTForVoice) → TTS\n` +
    `LiTT Runtime is the single brain. Vapi is just the voice gateway.\n`,
  );
}

main().catch((err) => {
  console.error(`\nBridge sync failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
