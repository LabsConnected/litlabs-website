/**
 * Vapi tool definitions — the canonical, versioned schemas for the eight
 * LiTT project tools exposed at POST /api/vapi/tools.
 *
 * These schemas describe the function parameters Vapi sends to the route.
 * They are the single source of truth for what each tool accepts, kept in
 * sync with the handlers in src/app/api/vapi/tools/route.ts.
 *
 * Use `buildVapiToolPayload()` to assemble the full tool object that Vapi's
 * REST API (POST/PATCH https://api.vapi.ai/tool) expects, including the
 * `server` block (URL + auth) and the spoken `messages` Vapi plays while a
 * tool runs.
 *
 * The sync script at scripts/sync-vapi-tools.ts consumes this module to
 * create/update tools and attach them to the LiTT assistant. Keeping the
 * definitions here (rather than inline in the script) means they are
 * type-checked, unit-testable, and reviewable in PRs.
 */

import { TOOL_NAMES, type ToolName, CHECK_IDS, type CheckId } from "./vapi-tools";

// ─── Types ──────────────────────────────────────────────────────

/** A JSON Schema parameter definition (OpenAI function-calling style). */
export interface ParameterSchema {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
}

/** The pure, transport-agnostic definition of one LiTT tool. */
export interface VapiToolDefinition {
  name: ToolName;
  description: string;
  parameters: ParameterSchema;
}

/** Spoken messages Vapi plays to the caller as the tool runs. */
export interface VapiToolMessage {
  type: "request-start" | "request-complete" | "request-failed" | "request-response-delayed";
  content: string;
}

/**
 * Options for assembling the full Vapi tool payload. Auth is provided via
 * either a static Authorization header (simplest) or a Vapi credential ID
 * (recommended — token stored encrypted in Vapi, referenced by ID).
 */
export interface BuildVapiToolOptions {
  /** Full URL of the server endpoint that receives tool calls. */
  serverUrl: string;
  /** Optional: raw `Authorization` header value, e.g. `Bearer <token>`. */
  authHeader?: string;
  /** Optional: Vapi credential ID for server auth (preferred over authHeader). */
  credentialId?: string;
  /** Request timeout in seconds (1-300). Defaults to 300 to match route maxDuration. */
  timeoutSeconds?: number;
  /** Spoken messages. Defaults to sensible per-tool messages if omitted. */
  messages?: VapiToolMessage[];
}

/** The full tool object accepted by POST/PATCH https://api.vapi.ai/tool. */
export interface VapiToolPayload {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: ParameterSchema;
  };
  server: {
    url: string;
    timeoutSeconds: number;
    headers?: Record<string, string>;
    credentialId?: string;
  };
  messages: VapiToolMessage[];
}

// ─── Parameter fragments ────────────────────────────────────────

const projectIdParam: ParameterSchema = {
  type: "string",
  description:
    "The LiTT project ID. Get it from get_active_project if you don't already have it.",
};

const pathParam: ParameterSchema = {
  type: "string",
  description:
    "Project-relative file or directory path (e.g. 'src/app/page.tsx'). " +
    "Must be relative, no '..' traversal, no absolute paths. " +
    "Blocked: .env*, node_modules, .git, .ssh, credentials, secrets.",
};

const changeSummaryParam: ParameterSchema = {
  type: "string",
  description: "A short human-readable summary of what the change does, for the audit log.",
};

const environmentParam: ParameterSchema = {
  type: "string",
  enum: ["preview", "staging", "production"],
  description: "Target deployment environment.",
};

const branchParam: ParameterSchema = {
  type: "string",
  description: "Git branch to preview. Defaults to the project's active branch.",
};

// ─── Tool definitions ───────────────────────────────────────────

export const VAPI_TOOL_DEFINITIONS: Record<ToolName, VapiToolDefinition> = {
  get_active_project: {
    name: "get_active_project",
    description:
      "Resolve the owner's currently active LiTT project. Returns the project ID, name, " +
      "repository, branch, and workspace status. Call this first before any other project tool.",
    parameters: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "Optional explicit project ID. If omitted, the owner's active project is used.",
        },
      },
      required: [],
    },
  },

  inspect_project_files: {
    name: "inspect_project_files",
    description:
      "List the contents of a directory in the project workspace. Use '.' for the project root. " +
      "Returns file/directory entries. Read-only.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        path: {
          type: "string",
          description: "Directory to list, relative to the project root. Use '.' for the root.",
        },
      },
      required: ["project_id"],
    },
  },

  read_file: {
    name: "read_file",
    description:
      "Read the full contents of a single file from the project workspace. Read-only. " +
      "Blocked paths (secrets, .env, node_modules, .git, etc.) are rejected.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        path: pathParam,
      },
      required: ["project_id", "path"],
    },
  },

  edit_file: {
    name: "edit_file",
    description:
      "Write the full new contents of a file in the project workspace. The entire file is " +
      "replaced with the provided content. The change is audited and a git diff is captured. " +
      "Blocked paths (secrets, .env, node_modules, .git, etc.) are rejected. " +
      "This does NOT deploy — call request_deployment_approval to ship a change.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        path: pathParam,
        content: {
          type: "string",
          description: "The complete new file contents (the whole file, not a patch).",
        },
        change_summary: changeSummaryParam,
      },
      required: ["project_id", "path", "content"],
    },
  },

  run_project_checks: {
    name: "run_project_checks",
    description:
      "Run safe project checks (typecheck, lint, test, build) in the workspace. " +
      "Returns pass/fail status and truncated output per check. Read-only to production.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        checks: {
          type: "array",
          items: {
            type: "string",
            enum: [...CHECK_IDS] as CheckId[],
          },
          description: `Checks to run. Omit to run all: ${CHECK_IDS.join(", ")}.`,
        },
      },
      required: ["project_id"],
    },
  },

  create_preview: {
    name: "create_preview",
    description:
      "Mark the project preview as ready and return the proxy URL. Does not deploy to production.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        branch: branchParam,
      },
      required: ["project_id"],
    },
  },

  get_deployment_status: {
    name: "get_deployment_status",
    description:
      "Read recent deployments, optionally filtered by environment. Read-only.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        environment: environmentParam,
      },
      required: ["project_id"],
    },
  },

  request_deployment_approval: {
    name: "request_deployment_approval",
    description:
      "Record a request to deploy. This is request-only — it NEVER performs a deployment. " +
      "Production deploys require separate explicit human approval recorded on the backend.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        environment: environmentParam,
        change_summary: changeSummaryParam,
      },
      required: ["project_id", "environment"],
    },
  },

  // ─── Browser Operator queue-control tools ──────────────────────
  // These are lightweight tools that enqueue, check, cancel, or approve
  // browser automation jobs. The actual browser execution happens
  // asynchronously — Vapi never waits for browser work to complete.

  browser_start_job: {
    name: "browser_start_job",
    description:
      "Enqueue a browser automation job. Returns immediately with a job ID — " +
      "the browser work runs asynchronously. Use browser_job_status to poll " +
      "for completion. Available job types: ghl.workflow.inspect (read-only, " +
      "inspects a GoHighLevel workflow and returns its structure as JSON).",
    parameters: {
      type: "object",
      properties: {
        job_type: {
          type: "string",
          enum: ["ghl.workflow.inspect", "ghl.workflow.list", "ghl.workflow.finish"],
          description:
            "The type of browser job to enqueue. " +
            "ghl.workflow.inspect: read-only inspection of a GHL workflow. " +
            "ghl.workflow.list: list all GHL workflows. " +
            "ghl.workflow.finish: create/finish a GHL workflow (requires approval).",
        },
        goal: {
          type: "string",
          description: "A human-readable description of what the job should accomplish.",
        },
        params: {
          type: "object",
          description:
            "Job-type-specific parameters. For ghl.workflow.inspect: " +
            "{ workflowName: string, ghlBaseUrl?: string }. " +
            "For ghl.workflow.list: { ghlBaseUrl?: string }. " +
            "For ghl.workflow.finish: { workflowName: string, branches: string[], webhookConfig: object }.",
          properties: {},
        },
        idempotency_key: {
          type: "string",
          description:
            "Optional. If provided, prevents duplicate jobs from retries. " +
            "If a job with this key already exists, the existing job is returned.",
        },
      },
      required: ["job_type", "params"],
    },
  },

  browser_job_status: {
    name: "browser_job_status",
    description:
      "Check the status of a browser automation job. Returns the current status, " +
      "progress (step tracking), result (if completed), and live view URL " +
      "(for watching the browser in real time). Poll this every few seconds " +
      "after calling browser_start_job.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job ID returned by browser_start_job.",
        },
      },
      required: ["job_id"],
    },
  },

  browser_cancel_job: {
    name: "browser_cancel_job",
    description:
      "Cancel a browser automation job. Only works if the job is still queued " +
      "or awaiting approval. Running jobs cannot be cancelled via this tool.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job ID to cancel.",
        },
      },
      required: ["job_id"],
    },
  },

  browser_approve_job: {
    name: "browser_approve_job",
    description:
      "Approve a browser automation job that is awaiting approval. " +
      "This allows a high-risk action (publish, delete, mass send) to proceed. " +
      "Only the site owner can approve jobs.",
    parameters: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job ID to approve.",
        },
      },
      required: ["job_id"],
    },
  },
};

/** Ordered list of all tool names, mirroring TOOL_NAMES. */
export const ALL_VAPI_TOOL_NAMES: ToolName[] = [...TOOL_NAMES];

// ─── Default spoken messages ────────────────────────────────────

const DEFAULT_MESSAGES: Record<ToolName, VapiToolMessage[]> = {
  get_active_project: [
    { type: "request-start", content: "Let me find your active project." },
    { type: "request-failed", content: "I couldn't find an active project. Want me to try again?" },
  ],
  inspect_project_files: [
    { type: "request-start", content: "Let me look at the files in your project." },
    { type: "request-failed", content: "I had trouble reading that directory." },
  ],
  read_file: [
    { type: "request-start", content: "Let me pull up that file." },
    { type: "request-failed", content: "I couldn't read that file — it may be blocked or missing." },
  ],
  edit_file: [
    { type: "request-start", content: "On it — updating that file now." },
    { type: "request-complete", content: "Done. I've updated the file. The change is recorded but not deployed." },
    { type: "request-failed", content: "I couldn't update that file. The path may be blocked or the workspace is unavailable." },
  ],
  run_project_checks: [
    { type: "request-start", content: "Running your project checks now — this may take a moment." },
    { type: "request-failed", content: "The checks didn't complete. The workspace may be busy." },
  ],
  create_preview: [
    { type: "request-start", content: "Spinning up a preview for you." },
    { type: "request-complete", content: "Your preview is ready." },
    { type: "request-failed", content: "I couldn't set up the preview." },
  ],
  get_deployment_status: [
    { type: "request-start", content: "Let me check your deployment status." },
    { type: "request-failed", content: "I couldn't fetch deployment status right now." },
  ],
  request_deployment_approval: [
    { type: "request-start", content: "Recording your deployment request." },
    { type: "request-complete", content: "I've recorded the request. It still needs your explicit approval before anything ships." },
    { type: "request-failed", content: "I couldn't record the deployment request." },
  ],
  browser_start_job: [
    { type: "request-start", content: "I'm opening the browser and starting that task now." },
    { type: "request-complete", content: "I've started the browser job. I'll check on it in a moment." },
    { type: "request-failed", content: "I couldn't start the browser job. The browser service may be unavailable." },
    { type: "request-response-delayed", content: "The browser job is taking a moment to queue up. Hang tight." },
  ],
  browser_job_status: [
    { type: "request-start", content: "Let me check on that browser job." },
    { type: "request-failed", content: "I couldn't find that job. It may have expired." },
  ],
  browser_cancel_job: [
    { type: "request-start", content: "Cancelling that browser job now." },
    { type: "request-complete", content: "Done. The browser job has been cancelled." },
    { type: "request-failed", content: "I couldn't cancel that job — it may already be running." },
  ],
  browser_approve_job: [
    { type: "request-start", content: "Approving that browser job now." },
    { type: "request-complete", content: "Approved. The browser job will continue with the high-risk action." },
    { type: "request-failed", content: "I couldn't approve that job — it may not be awaiting approval." },
  ],
};

// ─── Builder ────────────────────────────────────────────────────

/**
 * Assemble the full Vapi tool payload for POST/PATCH https://api.vapi.ai/tool.
 *
 * Auth precedence: `credentialId` (preferred, token stored in Vapi) over
 * `authHeader` (static Authorization header). If neither is provided the
 * server block omits auth — the route will reject calls with 401.
 */
export function buildVapiToolPayload(
  name: ToolName,
  options: BuildVapiToolOptions,
): VapiToolPayload {
  const def = VAPI_TOOL_DEFINITIONS[name];
  if (!def) {
    throw new Error(`Unknown Vapi tool: ${name}. Valid: ${ALL_VAPI_TOOL_NAMES.join(", ")}`);
  }

  const timeoutSeconds = options.timeoutSeconds ?? 300;
  if (timeoutSeconds < 1 || timeoutSeconds > 300) {
    throw new Error(`timeoutSeconds must be between 1 and 300 (got ${timeoutSeconds}).`);
  }

  const server: VapiToolPayload["server"] = {
    url: options.serverUrl,
    timeoutSeconds,
  };

  if (options.credentialId) {
    server.credentialId = options.credentialId;
  } else if (options.authHeader) {
    server.headers = { Authorization: options.authHeader };
  }

  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
    server,
    messages: options.messages ?? DEFAULT_MESSAGES[name],
  };
}

/**
 * Convenience: build payloads for a set of tools sharing the same server
 * config. Returns a map of tool name → payload.
 */
export function buildVapiToolPayloads(
  names: ToolName[],
  options: BuildVapiToolOptions,
): Record<ToolName, VapiToolPayload> {
  const out = {} as Record<ToolName, VapiToolPayload>;
  for (const name of names) {
    out[name] = buildVapiToolPayload(name, options);
  }
  return out;
}
