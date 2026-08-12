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

// ─── Behavior contract ──────────────────────────────────────────
//
// This contract should be included in the LiTT assistant's system prompt
// (configured in the Vapi dashboard). It is the single most important
// behavioral rule for the voice agent.
//
// The contract exists as a constant so it can be:
//   1. Imported by the sync script and printed for easy copy-paste
//   2. Included in future automated system-prompt sync
//   3. Versioned and reviewed in PRs

export const LITT_BEHAVIOR_CONTRACT = `
LITT BEHAVIOR CONTRACT — HONESTY OVER CONFIDENCE

1. NEVER claim an external action happened unless its tool returned success.
   - If send_email returns failure, tell the caller honestly.
   - If edit_file returns failure, say so — do not claim the file was updated.
   - If push_branch returns failure, do not say the branch was pushed.
   - If create_pull_request returns failure, do not say a PR was created.

2. NEVER promise to do something and then not call the tool.
   - If you say "I'll send you an email," you MUST call send_email.
   - If you say "I'll fix that," you MUST call edit_file.

3. If a tool is not available or not configured, say so plainly.
   - "Email sending isn't configured yet" is better than silence or false claims.

4. If a tool returns "pending_approval," tell the caller that approval is needed
   before the action will proceed. Do not claim the action is done.

5. If you are unsure whether something succeeded, say you are unsure.
   Do not fill gaps with confident-sounding fabrications.

6. Read-only operations (read_file, inspect_project_files, search_code, git_status,
   get_deployment_status) are safe to call freely.
   Mutating operations (edit_file, commit_changes, push_branch, create_pull_request,
   send_email, send_sms) should be called when the user requests them.
   Destructive operations (request_approval, request_deployment_approval) are
   request-only — they never execute anything themselves.

7. Always call get_active_project first if you need a project_id and don't have one.
`.trim();

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

  // ─── Owner notification tools ───────────────────────────────────

  send_sms: {
    name: "send_sms",
    description:
      "Send an SMS text message to the site owner. " +
      "SMS is currently UNAVAILABLE — the LiTT phone number does not support text messaging yet. " +
      "This tool always returns failure until an SMS-capable provider/number is configured. " +
      "Use this when the caller asks to be texted so the failure is recorded honestly. " +
      "Never claim the SMS was sent unless this returns success.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The SMS message body (max 1600 characters).",
        },
        to_number: {
          type: "string",
          description:
            "Destination phone number in E.164 format. " +
            "Defaults to the owner's configured phone number. " +
            "Alternate destinations must be explicitly server-side allowlisted " +
            "(LITTLABS_ALLOWED_RECIPIENTS) — arbitrary numbers are rejected.",
        },
      },
      required: ["message"],
    },
  },

  send_email: {
    name: "send_email",
    description:
      "Send an email to the site owner via Resend. " +
      "Returns success or failure — never claim the email was sent unless this returns success. " +
      "If email sending is not configured (RESEND_API_KEY missing), returns a clear failure " +
      "and the caller should be told honestly.",
    parameters: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Email subject line. Defaults to 'Message from LiTT'.",
        },
        body: {
          type: "string",
          description: "The email body (plain text).",
        },
        to_email: {
          type: "string",
          description:
            "Destination email address. " +
            "Defaults to the owner's configured email. " +
            "Alternate destinations must be explicitly server-side allowlisted " +
            "(LITTLABS_ALLOWED_RECIPIENTS) — arbitrary addresses are rejected.",
        },
      },
      required: ["body"],
    },
  },

  // ── Git operations — enable the full voice-driven dev workflow ──

  git_status: {
    name: "git_status",
    description:
      "Run 'git status --porcelain' in the project workspace. Returns structured " +
      "output of modified, staged, and untracked files. Read-only. " +
      "Never claim the repository is clean unless this returns an empty status.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
      },
      required: ["project_id"],
    },
  },

  create_branch: {
    name: "create_branch",
    description:
      "Create and switch to a new git branch in the project workspace. " +
      "The branch name must be a safe, simple slug (lowercase, hyphens, no spaces). " +
      "Returns success or failure — never claim the branch was created unless this returns success.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        branch_name: {
          type: "string",
          description:
            "The new branch name. Must be lowercase with hyphens (e.g. 'fix/mobile-nav'). " +
            "No spaces, no special characters except hyphens and slashes.",
        },
      },
      required: ["project_id", "branch_name"],
    },
  },

  commit_changes: {
    name: "commit_changes",
    description:
      "Stage all changes and create a git commit in the project workspace. " +
      "The commit message should be a clear, conventional-commits-style summary. " +
      "Returns success or failure with the commit SHA. " +
      "Never claim changes were committed unless this returns success with a SHA.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        message: {
          type: "string",
          description: "The commit message. Should be a clear summary of what changed (e.g. 'fix: close mobile nav on route change').",
        },
      },
      required: ["project_id", "message"],
    },
  },

  push_branch: {
    name: "push_branch",
    description:
      "Push the current branch to the remote repository (git push -u origin <branch>). " +
      "Returns success or failure. Never claim the branch was pushed unless this returns success.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        branch_name: {
          type: "string",
          description: "The branch to push. Defaults to the current active branch.",
        },
      },
      required: ["project_id"],
    },
  },

  create_pull_request: {
    name: "create_pull_request",
    description:
      "Create a GitHub pull request for the current (or specified) branch via the GitHub API. " +
      "Requires a GitHub connection (App or PAT). Returns the PR URL and number. " +
      "Never claim a PR was created unless this returns success with a PR number and URL.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        title: {
          type: "string",
          description: "The PR title.",
        },
        body: {
          type: "string",
          description: "The PR description (markdown). Should summarize what changed and why.",
        },
        branch_name: {
          type: "string",
          description: "The head branch to merge from. Defaults to the current active branch.",
        },
        base_branch: {
          type: "string",
          description: "The base branch to merge into. Defaults to the repository's default branch (usually 'main').",
        },
      },
      required: ["project_id", "title"],
    },
  },

  // ── Code search + project memory ───────────────────────────────

  search_code: {
    name: "search_code",
    description:
      "Search for a text pattern across the project workspace using ripgrep. " +
      "Returns matching file paths, line numbers, and truncated line content. " +
      "Read-only. Use this to find where code lives before editing it.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        pattern: {
          type: "string",
          description: "The text pattern or regex to search for.",
        },
        file_glob: {
          type: "string",
          description: "Optional file glob to narrow the search (e.g. '*.tsx', 'src/**/*.ts').",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of matches to return. Defaults to 20.",
        },
      },
      required: ["project_id", "pattern"],
    },
  },

  remember_project_context: {
    name: "remember_project_context",
    description:
      "Persist a piece of project context to memory so LiTT can recall it in future conversations. " +
      "Use this when the user tells you something worth remembering about the project " +
      "(architecture decisions, preferences, constraints, goals). " +
      "Returns success or failure — never claim you remembered something unless this returns success. " +
      "Secrets, API keys, and credentials are automatically blocked.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        content: {
          type: "string",
          description: "The context to remember. Should be a clear, self-contained statement (e.g. 'The mobile nav uses a Zustand store for open/close state').",
        },
        memory_type: {
          type: "string",
          enum: ["project_fact", "project_decision", "architecture", "workflow", "constraint", "user_preference"],
          description: "The type of memory. Defaults to 'project_fact'.",
        },
      },
      required: ["project_id", "content"],
    },
  },

  // ── General approval gate ──────────────────────────────────────

  request_approval: {
    name: "request_approval",
    description:
      "Record a request to perform a high-risk or destructive operation. " +
      "This is request-only — it NEVER executes the operation. " +
      "The operation requires separate explicit human approval recorded on the backend. " +
      "Use this for: database schema changes, bulk deletes, force-pushes, " +
      "production config changes, or any action with irreversible side effects. " +
      "Never claim the operation was approved or executed unless a separate approval " +
      "confirmation is received.",
    parameters: {
      type: "object",
      properties: {
        project_id: projectIdParam,
        action: {
          type: "string",
          description: "A short identifier for the requested action (e.g. 'drop_users_table', 'force_push_main').",
        },
        description: {
          type: "string",
          description: "A human-readable description of what the operation will do and why it's needed.",
        },
        risk_level: {
          type: "string",
          enum: ["medium", "high", "critical"],
          description: "The risk level. 'critical' includes irreversible or production-impacting actions.",
        },
      },
      required: ["action", "description", "risk_level"],
    },
  },

  // ── Synchronous browser test ───────────────────────────────────

  browser_test: {
    name: "browser_test",
    description:
      "Open a URL in the browser, wait for it to load, and return the page title, " +
      "any console errors, and a screenshot URL. This is SYNCHRONOUS — it blocks until " +
      "the browser work completes (up to 60 seconds). " +
      "Use this to visually test a page after making changes. " +
      "Never claim a page works unless this returns success with no console errors.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to test. Can be a preview URL, localhost, or any accessible URL.",
        },
        viewport_width: {
          type: "integer",
          description: "Browser viewport width in pixels. Defaults to 1280. Use 375 for mobile testing.",
        },
        viewport_height: {
          type: "integer",
          description: "Browser viewport height in pixels. Defaults to 720.",
        },
      },
      required: ["url"],
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
  send_sms: [
    { type: "request-start", content: "I'll check whether texting is available." },
    { type: "request-complete", content: "Done. I've sent you a text." },
    { type: "request-failed", content: "I can't send texts yet — the phone number doesn't support texting." },
  ],
  send_email: [
    { type: "request-start", content: "Sending you an email now." },
    { type: "request-complete", content: "Done. I've sent you an email." },
    { type: "request-failed", content: "I couldn't send the email — email sending may not be configured yet." },
  ],
  // ── Git operations ──
  git_status: [
    { type: "request-start", content: "Let me check the git status of your project." },
    { type: "request-failed", content: "I couldn't check the git status. The workspace may be busy." },
  ],
  create_branch: [
    { type: "request-start", content: "Creating a new branch for this work." },
    { type: "request-complete", content: "Done. I've created and switched to the new branch." },
    { type: "request-failed", content: "I couldn't create that branch. The name may be invalid or the workspace is busy." },
  ],
  commit_changes: [
    { type: "request-start", content: "Committing your changes now." },
    { type: "request-complete", content: "Done. I've committed the changes." },
    { type: "request-failed", content: "I couldn't commit — there may be nothing to commit or the workspace is busy." },
  ],
  push_branch: [
    { type: "request-start", content: "Pushing the branch to your remote repository." },
    { type: "request-complete", content: "Done. The branch has been pushed." },
    { type: "request-failed", content: "I couldn't push the branch. Your GitHub connection may need attention." },
  ],
  create_pull_request: [
    { type: "request-start", content: "Creating a pull request for you now." },
    { type: "request-complete", content: "Done. I've created the pull request." },
    { type: "request-failed", content: "I couldn't create the pull request. Your GitHub connection may need attention." },
  ],
  // ── Search + memory ──
  search_code: [
    { type: "request-start", content: "Searching your codebase for that." },
    { type: "request-failed", content: "I couldn't search the codebase right now." },
  ],
  remember_project_context: [
    { type: "request-start", content: "I'll remember that for next time." },
    { type: "request-complete", content: "Done. I've saved that context for future conversations." },
    { type: "request-failed", content: "I couldn't save that context. It may contain blocked content." },
  ],
  // ── Approval gate ──
  request_approval: [
    { type: "request-start", content: "Recording your approval request for this operation." },
    { type: "request-complete", content: "I've recorded the request. It still needs your explicit approval before anything happens." },
    { type: "request-failed", content: "I couldn't record the approval request." },
  ],
  // ── Sync browser test ──
  browser_test: [
    { type: "request-start", content: "Opening that page in the browser to test it now." },
    { type: "request-complete", content: "Done. I've loaded the page and captured the results." },
    { type: "request-failed", content: "I couldn't test that page — the browser service may be unavailable." },
    { type: "request-response-delayed", content: "The page is still loading. Hang tight." },
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
