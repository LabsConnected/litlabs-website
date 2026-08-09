#!/usr/bin/env tsx
/**
 * pnpm sync:vapi-tools [--tools=edit_file,inspect_project_files,read_file] [--no-attach] [--dry-run]
 *
 * Creates/updates Vapi tools (POST/PATCH https://api.vapi.ai/tool) from the
 * versioned definitions in src/lib/vapi-tool-definitions.ts, then attaches
 * them to the LiTT assistant by merging into the assistant's `toolIds`.
 *
 * Idempotent: if a tool with the same name already exists in your Vapi org,
 * it is PATCHed in place (preserving its ID) rather than duplicated.
 *
 * Existing tools already attached to the assistant are preserved — this
 * script only ADDS the synced tools' IDs to the assistant's `toolIds`. It
 * never removes tools. To detach, use the Vapi dashboard.
 *
 * Required env (load via .env.local or export before running):
 *   VAPI_API_KEY                  — Vapi private API key (dashboard → API Keys)
 *   LITTLABS_VAPI_TOOL_TOKEN      — shared secret the route auths against (>=16 chars)
 *   LITTLABS_VAPI_OWNER_CLERK_ID  — Clerk user ID of the site owner
 *
 * Optional env:
 *   VAPI_ASSISTANT_ID             — default: ef18583c-3538-4025-ad9f-2114d745525e (LiTT)
 *   VAPI_TOOL_SERVER_URL          — default: https://litlabs.net/api/vapi/tools
 *   LITTLABS_VAPI_CREDENTIAL_ID   — Vapi credential ID for server auth (preferred over
 *                                   embedding the token in server.headers)
 *   VAPI_TOOL_TIMEOUT_SECONDS     — default: 300
 *
 * This script never prints secret values.
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import {
  buildVapiToolPayload,
  ALL_VAPI_TOOL_NAMES,
  type VapiToolPayload,
} from "../src/lib/vapi-tool-definitions";
import type { ToolName } from "../src/lib/vapi-tools";

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
const OWNER_CLERK_ID = process.env.LITTLABS_VAPI_OWNER_CLERK_ID;
const ASSISTANT_ID =
  process.env.VAPI_ASSISTANT_ID ?? "ef18583c-3538-4025-ad9f-2114d745525e";
const SERVER_URL =
  process.env.VAPI_TOOL_SERVER_URL ?? "https://litlabs.net/api/vapi/tools";
const CREDENTIAL_ID = process.env.LITTLABS_VAPI_CREDENTIAL_ID;
const TIMEOUT_SECONDS = Number(process.env.VAPI_TOOL_TIMEOUT_SECONDS ?? 300);

const VAPI_BASE = "https://api.vapi.ai";

// ─── CLI args ───────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  tools: ToolName[];
  attach: boolean;
  dryRun: boolean;
} {
  const argMap: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const m = /^--([a-zA-Z-]+)(?:=(.*))?$/.exec(a);
    if (m) argMap[m[1]] = m[2] ?? "true";
  }

  const toolsRaw = (argMap.tools ?? "edit_file,inspect_project_files,read_file")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const invalid = toolsRaw.filter((t) => !ALL_VAPI_TOOL_NAMES.includes(t as ToolName));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown tool(s): ${invalid.join(", ")}. Valid: ${ALL_VAPI_TOOL_NAMES.join(", ")}`,
    );
  }

  return {
    tools: toolsRaw as ToolName[],
    attach: argMap.attach !== "false" && argMap["no-attach"] !== "true",
    dryRun: argMap["dry-run"] === "true",
  };
}

// ─── Vapi API helpers ───────────────────────────────────────────

async function vapiFetch(
  urlPath: string,
  method: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${VAPI_BASE}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VAPI_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
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

/** List all tools in the org. Vapi's /tool endpoint supports `limit` (max 100) but not `offset`. */
async function listAllTools(): Promise<any[]> {
  const batch = await vapiFetch(`/tool?limit=100`, "GET");
  return Array.isArray(batch) ? batch : [];
}

/** Find an existing tool by its function name. Returns the tool object or null. */
function findToolByName(tools: any[], name: string): any | null {
  return (
    tools.find(
      (t) => t?.function?.name === name || t?.name === name,
    ) ?? null
  );
}

/** Create or update a tool. Returns the tool object (with id). */
async function upsertTool(
  existing: any | null,
  payload: VapiToolPayload,
): Promise<{ id: string; created: boolean }> {
  if (existing?.id) {
    await vapiFetch(`/tool/${existing.id}`, "PATCH", payload);
    return { id: existing.id, created: false };
  }
  const created = await vapiFetch(`/tool`, "POST", payload);
  if (!created?.id) throw new Error("Vapi created a tool but returned no id.");
  return { id: created.id, created: true };
}

/** Get the current assistant config. */
async function getAssistant(id: string): Promise<any> {
  return vapiFetch(`/assistant/${id}`, "GET");
}

/** Merge new tool IDs into the assistant's existing model.toolIds (no removals). */
async function attachToolsToAssistant(
  assistantId: string,
  toolIdsToAdd: string[],
): Promise<{ added: string[]; alreadyPresent: string[]; total: number }> {
  const assistant = await getAssistant(assistantId);
  // Vapi nests toolIds under `model`, not at the top level.
  const existing: string[] = Array.isArray(assistant?.model?.toolIds)
    ? assistant.model.toolIds
    : Array.isArray(assistant?.toolIds)
      ? assistant.toolIds
      : [];

  const toAdd = toolIdsToAdd.filter((id) => !existing.includes(id));
  const alreadyPresent = toolIdsToAdd.filter((id) => existing.includes(id));

  if (toAdd.length > 0) {
    const merged = [...existing, ...toAdd];
    await vapiFetch(`/assistant/${assistantId}`, "PATCH", {
      model: { toolIds: merged },
    });
  }

  return {
    added: toAdd,
    alreadyPresent,
    total: existing.length + toAdd.length,
  };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const { tools, attach, dryRun } = parseArgs(process.argv);

  // ── Validate env ──
  const missing: string[] = [];
  if (!VAPI_API_KEY) missing.push("VAPI_API_KEY");
  if (!TOOL_TOKEN || TOOL_TOKEN.length < 16) missing.push("LITTLABS_VAPI_TOOL_TOKEN (>=16 chars)");
  if (attach && !OWNER_CLERK_ID) missing.push("LITTLABS_VAPI_OWNER_CLERK_ID");
  if (missing.length > 0) {
    console.error(
      `\nMissing required env: ${missing.join(", ")}.\n` +
        `Put them in .env.local or export before running. See scripts/VERCEL_ENV_VARS.md.\n`,
    );
    process.exit(1);
  }

  const authHeader = CREDENTIAL_ID ? undefined : `Bearer ${TOOL_TOKEN}`;

  console.log(`\nLiTT Vapi tool sync`);
  console.log(`  server url      : ${SERVER_URL}`);
  console.log(`  assistant id    : ${ASSISTANT_ID}`);
  console.log(`  auth mode       : ${CREDENTIAL_ID ? "credentialId" : "server.headers (Bearer)"}`);
  console.log(`  timeout (s)     : ${TIMEOUT_SECONDS}`);
  console.log(`  tools to sync   : ${tools.join(", ")}`);
  console.log(`  attach to assist: ${attach ? "yes" : "no"}`);
  console.log(`  dry run         : ${dryRun ? "yes" : "no"}\n`);

  if (dryRun) {
    console.log("Dry run — would push these payloads:\n");
    for (const name of tools) {
      const payload = buildVapiToolPayload(name, {
        serverUrl: SERVER_URL,
        authHeader,
        credentialId: CREDENTIAL_ID,
        timeoutSeconds: TIMEOUT_SECONDS,
      });
      // Redact the auth header in dry-run output.
      const safe = JSON.parse(JSON.stringify(payload)) as VapiToolPayload;
      if (safe.server.headers?.Authorization) {
        safe.server.headers.Authorization = "Bearer <redacted>";
      }
      console.log(`${name}:`);
      console.log(JSON.stringify(safe, null, 2));
      console.log("");
    }
    return;
  }

  // ── 1. Discover existing tools ──
  console.log("Fetching existing tools from Vapi...");
  const existingTools = await listAllTools();
  console.log(`  found ${existingTools.length} tool(s) in org.`);

  // ── 2. Upsert each tool ──
  const synced: { name: ToolName; id: string; created: boolean }[] = [];
  for (const name of tools) {
    const payload = buildVapiToolPayload(name, {
      serverUrl: SERVER_URL,
      authHeader,
      credentialId: CREDENTIAL_ID,
      timeoutSeconds: TIMEOUT_SECONDS,
    });
    const existing = findToolByName(existingTools, name);
    const { id, created } = await upsertTool(existing, payload);
    synced.push({ name, id, created });
    console.log(`  ${created ? "created" : "updated"} ${name}  ->  ${id}`);
  }

  // ── 3. Attach to assistant ──
  if (attach) {
    console.log(`\nAttaching tools to assistant ${ASSISTANT_ID}...`);
    const result = await attachToolsToAssistant(
      ASSISTANT_ID,
      synced.map((s) => s.id),
    );
    console.log(`  added          : ${result.added.length}`);
    if (result.added.length > 0) {
      for (const s of synced) {
        if (result.added.includes(s.id)) console.log(`    + ${s.name} (${s.id})`);
      }
    }
    console.log(`  already present: ${result.alreadyPresent.length}`);
    console.log(`  total toolIds  : ${result.total}`);
  } else {
    console.log("\nSkipping assistant attach (--no-attach).");
  }

  // ── 4. Summary ──
  console.log("\nDone. Synced tools:");
  for (const s of synced) {
    console.log(`  ${s.name}  ${s.created ? "(created)" : "(updated)"}  ${s.id}`);
  }

  if (attach) {
    console.log(
      `\nNext: smoke-test with the curl commands in AGENTS.md (Vapi Tools section). ` +
        `Activation order: confirm get_active_project works, then exercise edit_file on a ` +
        `throwaway path before trusting it on real source.\n`,
    );
  } else {
    console.log(
      `\nTools are created/updated but NOT attached. Attach via the Vapi dashboard or ` +
        `re-run without --no-attach.\n`,
    );
  }
}

main().catch((err) => {
  console.error(`\nSync failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
