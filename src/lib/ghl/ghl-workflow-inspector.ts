/**
 * GHL Workflow Inspector
 *
 * The first browser job type: "ghl.workflow.inspect".
 * Navigates to GoHighLevel, opens a workflow, and extracts its
 * structure (nodes, branches, webhook config) as structured JSON.
 *
 * Uses the existing browser-session-manager + Stagehand infrastructure.
 * Selector strategy: DOM/accessibility selectors first, text matching
 * via Stagehand's act()/extract() as fallback.
 *
 * Auth handling:
 *   GHL requires a logged-in session. The inspector checks whether
 *   the browser is authenticated and returns a "needs_login" status
 *   with the live view URL if not — so the user can log in manually
 *   via the human_control mode. Future: warm-pool with saved storageState.
 */

import "server-only";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
  startSession,
  closeSession,
  executeBrowserAction,
  takeScreenshot,
} from "@/lib/litt-intelligence/browser-session-manager";
import {
  buildInitialProgress,
  advanceProgress,
  updateJobProgress,
  updateJobSession,
  emitJobEvent,
  type JobProgress,
} from "@/lib/browser-jobs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightPage = any;

// ─── Types ──────────────────────────────────────────────────────

export interface GHLWorkflowNode {
  id: string;
  type: string;        // trigger, action, condition/branch, wait, etc.
  name: string;
  config?: Record<string, unknown>;
}

export interface GHLWorkflowBranch {
  label: string;
  condition?: string;
}

export interface GHLWorkflowInspectionResult {
  workflow: string;
  status: string;       // draft, published, etc.
  nodes: GHLWorkflowNode[];
  branches: string[];
  webhookConfig: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    mappedFields?: Record<string, string>;
  } | null;
  missing: string[];    // missing pieces detected
  liveViewUrl: string | null;
  screenshotUrl?: string;
  needsLogin: boolean;
}

export interface InspectWorkflowParams {
  workflowName: string;
  ghlBaseUrl?: string;  // defaults to https://app.gohighlevel.com
}

export interface InspectWorkflowOptions {
  userId: string;
  jobId: string;
  params: InspectWorkflowParams;
}

// ─── Constants ──────────────────────────────────────────────────

const DEFAULT_GHL_BASE_URL = "https://app.gohighlevel.com";
const WORKFLOWS_PATH = "/v2/workflows";
const LOGIN_INDICATOR_SELECTOR = 'input[type="email"], input[name="email"], form[action*="login"]';
const STEP_LABELS = [
  "Start browser session",
  "Navigate to GHL workflows",
  "Check authentication",
  "Find target workflow",
  "Open workflow editor",
  "Extract workflow nodes",
  "Extract branches and conditions",
  "Extract webhook configuration",
  "Identify missing pieces",
  "Return structured result",
];

// ─── Helpers ────────────────────────────────────────────────────

function ghlBaseUrl(params: InspectWorkflowParams): string {
  const url = params.ghlBaseUrl ?? process.env.GHL_BASE_URL ?? DEFAULT_GHL_BASE_URL;
  return url.replace(/\/$/, ""); // strip trailing slash
}

/**
 * Check if the current page is a GHL login page (not authenticated).
 */
async function isOnLoginPage(page: PlaywrightPage): Promise<boolean> {
  try {
    const loginEl = await page.$(LOGIN_INDICATOR_SELECTOR);
    return !!loginEl;
  } catch {
    return false;
  }
}

/**
 * Extract the workflow list from the GHL workflows page.
 * Returns an array of { name, status, id } entries.
 */
async function extractWorkflowList(page: PlaywrightPage): Promise<{ name: string; status: string; id: string }[]> {
  // Try structured extraction via DOM first
  try {
    const workflows = await page.evaluate(() => {
      // GHL workflow list items — selectors may vary, try multiple patterns
      const items = document.querySelectorAll(
        '[data-testid*="workflow"], [class*="workflow-item"], [class*="workflow-card"], tr[class*="workflow"]'
      );
      const results: { name: string; status: string; id: string }[] = [];
      items.forEach((item) => {
        const nameEl = item.querySelector('[class*="name"], [class*="title"], h3, h4, td:first-child');
        const statusEl = item.querySelector('[class*="status"], [class*="badge"]');
        const name = nameEl?.textContent?.trim() ?? "";
        const status = statusEl?.textContent?.trim() ?? "unknown";
        const id = item.getAttribute("data-id") ?? item.getAttribute("data-testid") ?? "";
        if (name) results.push({ name, status, id });
      });
      return results;
    });

    if (workflows.length > 0) return workflows;
  } catch {
    // Fall through to Stagehand extract
  }

  // Fallback: use Stagehand's extract via page.evaluate to get visible text
  try {
    const text = await page.evaluate(() => {
      const body = document.body;
      if (!body) return "";
      return body.innerText.slice(0, 5000);
    });
    // Parse workflow names from text — look for patterns like "Workflow Name" followed by status
    const lines = text.split("\n").filter((l: string) => l.trim().length > 0);
    const workflows: { name: string; status: string; id: string }[] = [];
    for (const line of lines) {
      // Heuristic: lines that look like workflow names (not navigation/headers)
      if (line.length > 3 && line.length < 100 && !line.includes("Search") && !line.includes("Create") && !line.includes("Filter")) {
        workflows.push({ name: line.trim(), status: "unknown", id: "" });
      }
    }
    return workflows.slice(0, 20); // limit to 20
  } catch {
    return [];
  }
}

/**
 * Extract workflow nodes from the workflow editor page.
 */
async function extractWorkflowNodes(page: PlaywrightPage): Promise<GHLWorkflowNode[]> {
  try {
    const nodes = await page.evaluate(() => {
      // GHL workflow editor nodes — try multiple selector patterns
      const nodeEls = document.querySelectorAll(
        '[data-testid*="node"], [class*="workflow-node"], [class*="flow-node"], [class*="node-item"], .react-flow__node'
      );
      const results: GHLWorkflowNode[] = [];
      nodeEls.forEach((el, i) => {
        const nameEl = el.querySelector('[class*="title"], [class*="name"], h4, h5, span');
        const typeEl = el.querySelector('[class*="type"], [class*="label"]');
        const name = nameEl?.textContent?.trim() ?? `Node ${i + 1}`;
        const type = typeEl?.textContent?.trim() ?? "action";
        const id = el.getAttribute("data-id") ?? el.getAttribute("data-nodeid") ?? `node-${i}`;
        results.push({ id, type, name });
      });
      return results;
    });
    return nodes;
  } catch {
    return [];
  }
}

/**
 * Extract branch/condition labels from the workflow editor.
 */
async function extractBranches(page: PlaywrightPage): Promise<string[]> {
  try {
    const branches = await page.evaluate(() => {
      // Branch/condition elements in GHL workflow editor
      const branchEls = document.querySelectorAll(
        '[class*="branch"], [class*="condition"], [class*="if-else"], [data-testid*="branch"], [data-testid*="condition"]'
      );
      const results: Set<string> = new Set();
      branchEls.forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length > 0 && text.length < 100) {
          results.add(text);
        }
      });
      return [...results];
    });
    return branches;
  } catch {
    return [];
  }
}

/**
 * Extract webhook configuration from the workflow editor.
 */
async function extractWebhookConfig(page: PlaywrightPage): Promise<GHLWorkflowInspectionResult["webhookConfig"]> {
  try {
    const config = await page.evaluate(() => {
      // Look for webhook-related elements
      const webhookEls = document.querySelectorAll(
        '[class*="webhook"], [data-testid*="webhook"], [class*="http-request"], [class*="api-call"]'
      );
      if (webhookEls.length === 0) return null;

      let url = "";
      let method = "";
      const headers: Record<string, string> = {};
      const mappedFields: Record<string, string> = {};

      // Try to extract URL from input fields or text content
      webhookEls.forEach((el) => {
        const urlInput = el.querySelector('input[type="url"], input[class*="url"], input[placeholder*="url"], input[placeholder*="URL"]');
        if (urlInput) {
          url = (urlInput as HTMLInputElement).value || urlInput.getAttribute("placeholder") || "";
        }
        const methodSelect = el.querySelector('select[class*="method"], [class*="method"]');
        if (methodSelect) {
          method = methodSelect.textContent?.trim() ?? "";
        }
        const text = el.textContent ?? "";
        if (text.includes("POST")) method = method || "POST";
        if (text.includes("GET")) method = method || "GET";
      });

      return { url: url || undefined, method: method || undefined, headers, mappedFields };
    });
    return config;
  } catch {
    return null;
  }
}

// ─── Main inspection function ───────────────────────────────────

/**
 * Inspect a GHL workflow and return its structure as JSON.
 *
 * Steps:
 *   1. Start a browser session (or reuse existing)
 *   2. Navigate to GHL workflows page
 *   3. Check if authenticated (return needs_login if not)
 *   4. Find the target workflow by name
 *   5. Open the workflow editor
 *   6. Extract nodes, branches, webhook config
 *   7. Identify missing pieces
 *   8. Return structured result
 */
export async function inspectGhlWorkflow(
  options: InspectWorkflowOptions,
): Promise<GHLWorkflowInspectionResult> {
  const { userId, jobId, params } = options;
  const workflowName = params.workflowName;
  if (!workflowName) {
    throw new Error("workflowName is required");
  }

  const baseUrl = ghlBaseUrl(params);
  let progress: JobProgress = buildInitialProgress(STEP_LABELS);

  // Step 1: Start browser session
  progress = advanceProgress(progress, 0, "running");
  await updateJobProgress(jobId, progress);
  await emitJobEvent({ jobId, type: "step.started", step: 0, message: "Starting browser session" });

  const session = await startSession({
    userId,
    task: `Inspect GHL workflow: ${workflowName}`,
  });

  await updateJobSession(jobId, session.id, session.liveViewUrl);
  progress = advanceProgress(progress, 0, "completed");
  await emitJobEvent({ jobId, type: "step.completed", step: 0, message: "Browser session started", metadata: { liveViewUrl: session.liveViewUrl } });
  progress = advanceProgress(progress, 1, "running");
  await updateJobProgress(jobId, progress);
  await emitJobEvent({ jobId, type: "step.started", step: 1, message: `Navigating to ${baseUrl}${WORKFLOWS_PATH}` });

  try {
    // Step 2: Navigate to GHL workflows page
    const workflowsUrl = `${baseUrl}${WORKFLOWS_PATH}`;
    await executeBrowserAction(session.id, userId, "browser.navigate", { url: workflowsUrl }, async (stagehand: Stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };
      await page.goto(workflowsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      // Wait for page to settle
      await page.waitForTimeout(3000);
      return { success: true, durationMs: 0 };
    });

    progress = advanceProgress(progress, 1, "completed");
    progress = advanceProgress(progress, 2, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "step.started", step: 2, message: "Checking authentication" });

    // Step 3: Check authentication
    const needsLogin = await executeBrowserAction(
      session.id,
      userId,
      "browser.snapshot",
      {},
      async (stagehand: Stagehand) => {
        const page = stagehand.context.pages()[0] as PlaywrightPage;
        if (!page) return { success: false, error: "No page available", durationMs: 0 };
        const onLogin = await isOnLoginPage(page);
        return { success: true, data: { needsLogin: onLogin }, durationMs: 0 };
      },
    );

    if (needsLogin.data && (needsLogin.data as { needsLogin?: boolean }).needsLogin) {
      // Not authenticated — return needs_login status with live view URL
      progress = advanceProgress(progress, 2, "completed", "Needs login");
      await updateJobProgress(jobId, progress);
      await emitJobEvent({ jobId, type: "observation", step: 2, message: "Not authenticated — GHL login required", metadata: { needsLogin: true, liveViewUrl: session.liveViewUrl } });
      await emitJobEvent({ jobId, type: "approval.required", message: "Manual login required via live view", metadata: { liveViewUrl: session.liveViewUrl } });

      const screenshot = await takeScreenshot(session.id);
      return {
        workflow: workflowName,
        status: "needs_login",
        nodes: [],
        branches: [],
        webhookConfig: null,
        missing: ["authentication"],
        liveViewUrl: session.liveViewUrl,
        screenshotUrl: screenshot ?? undefined,
        needsLogin: true,
      };
    }

    progress = advanceProgress(progress, 2, "completed");
    progress = advanceProgress(progress, 3, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "observation", step: 2, message: "Authenticated — proceeding" });
    await emitJobEvent({ jobId, type: "step.started", step: 3, message: `Searching for workflow "${workflowName}"` });

    // Step 4: Find the target workflow
    let workflowFound = false;
    let workflowStatus = "unknown";

    await executeBrowserAction(
      session.id,
      userId,
      "browser.extract",
      { selector: "workflow list" },
      async (stagehand: Stagehand) => {
        const page = stagehand.context.pages()[0] as PlaywrightPage;
        if (!page) return { success: false, error: "No page available", durationMs: 0 };

        const workflowList = await extractWorkflowList(page);
        const match = workflowList.find(
          (w) => w.name.toLowerCase().includes(workflowName.toLowerCase()),
        );

        if (match) {
          workflowFound = true;
          workflowStatus = match.status;

          // Click on the matching workflow to open the editor
          // Try clicking by text first (Stagehand's act handles natural language)
          try {
            await stagehand.act(`Click on the workflow named "${match.name}"`);
          } catch {
            // Fallback: try direct selector click
            const linkEl = await page.$(`text="${match.name}"`);
            if (linkEl) await linkEl.click();
          }
          await page.waitForTimeout(3000); // wait for editor to load
        }

        return { success: true, data: { workflowList, match }, durationMs: 0 };
      },
    );

    if (!workflowFound) {
      progress = advanceProgress(progress, 3, "failed", "Workflow not found");
      await updateJobProgress(jobId, progress);
      await emitJobEvent({ jobId, type: "observation", step: 3, message: `Workflow "${workflowName}" not found`, metadata: { workflowName } });

      return {
        workflow: workflowName,
        status: "not_found",
        nodes: [],
        branches: [],
        webhookConfig: null,
        missing: ["workflow_not_found"],
        liveViewUrl: session.liveViewUrl,
        needsLogin: false,
      };
    }

    progress = advanceProgress(progress, 3, "completed");
    progress = advanceProgress(progress, 4, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "step.completed", step: 3, message: `Found workflow: ${workflowName}`, metadata: { workflowStatus } });
    await emitJobEvent({ jobId, type: "action", step: 3, message: `Opened workflow editor for "${workflowName}"` });
    await emitJobEvent({ jobId, type: "step.started", step: 4, message: "Waiting for workflow editor to load" });

    // Step 5: Wait for workflow editor to fully load
    await executeBrowserAction(session.id, userId, "browser.wait", {}, async (stagehand: Stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };
      await page.waitForTimeout(3000);
      return { success: true, durationMs: 0 };
    });

    progress = advanceProgress(progress, 4, "completed");
    progress = advanceProgress(progress, 5, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "step.started", step: 5, message: "Extracting workflow nodes" });

    // Step 6: Extract workflow nodes
    let nodes: GHLWorkflowNode[] = [];
    await executeBrowserAction(session.id, userId, "browser.extract", {}, async (stagehand: Stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };
      nodes = await extractWorkflowNodes(page);
      return { success: true, data: { nodeCount: nodes.length }, durationMs: 0 };
    });

    progress = advanceProgress(progress, 5, "completed");
    progress = advanceProgress(progress, 6, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "step.completed", step: 5, message: `Extracted ${nodes.length} nodes`, metadata: { nodeCount: nodes.length } });
    await emitJobEvent({ jobId, type: "step.started", step: 6, message: "Extracting branches and conditions" });

    // Step 7: Extract branches
    let branches: string[] = [];
    await executeBrowserAction(session.id, userId, "browser.extract", {}, async (stagehand: Stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };
      branches = await extractBranches(page);
      return { success: true, data: { branchCount: branches.length }, durationMs: 0 };
    });

    progress = advanceProgress(progress, 6, "completed");
    progress = advanceProgress(progress, 7, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "step.completed", step: 6, message: `Extracted ${branches.length} branches`, metadata: { branchCount: branches.length } });
    await emitJobEvent({ jobId, type: "step.started", step: 7, message: "Extracting webhook configuration" });

    // Step 8: Extract webhook configuration
    // Use a wrapper object to avoid TypeScript control-flow narrowing to null
    // (assignments inside closures don't widen the variable's type in the outer scope)
    const whConfigRef: { value: GHLWorkflowInspectionResult["webhookConfig"] } = { value: null };
    await executeBrowserAction(session.id, userId, "browser.extract", {}, async (stagehand: Stagehand) => {
      const page = stagehand.context.pages()[0] as PlaywrightPage;
      if (!page) return { success: false, error: "No page available", durationMs: 0 };
      whConfigRef.value = await extractWebhookConfig(page);
      return { success: true, data: { hasWebhook: !!whConfigRef.value }, durationMs: 0 };
    });

    progress = advanceProgress(progress, 7, "completed");
    progress = advanceProgress(progress, 8, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "step.completed", step: 7, message: whConfigRef.value ? "Webhook configuration found" : "No webhook configuration detected", metadata: { hasWebhook: !!whConfigRef.value } });
    await emitJobEvent({ jobId, type: "step.started", step: 8, message: "Identifying missing pieces" });

    // Step 9: Identify missing pieces
    const whConfig = whConfigRef.value;
    const missing: string[] = [];
    if (nodes.length === 0) missing.push("nodes_not_detected");
    if (branches.length === 0) missing.push("branches_not_detected");
    if (!whConfig) missing.push("webhook_config_not_detected");
    if (!whConfig?.url) missing.push("webhook_url_not_set");
    if (!whConfig?.mappedFields || Object.keys(whConfig?.mappedFields ?? {}).length === 0) {
      missing.push("webhook_field_mapping_not_set");
    }

    await emitJobEvent({ jobId, type: "verification", step: 8, message: `Identified ${missing.length} missing pieces`, metadata: { missing } });

    progress = advanceProgress(progress, 8, "completed");
    progress = advanceProgress(progress, 9, "running");
    await updateJobProgress(jobId, progress);
    await emitJobEvent({ jobId, type: "step.started", step: 9, message: "Returning structured result" });

    // Step 10: Return structured result
    const screenshot = await takeScreenshot(session.id);
    progress = advanceProgress(progress, 9, "completed");
    await updateJobProgress(jobId, progress);

    return {
      workflow: workflowName,
      status: workflowStatus,
      nodes,
      branches,
      webhookConfig: whConfig,
      missing,
      liveViewUrl: session.liveViewUrl,
      screenshotUrl: screenshot ?? undefined,
      needsLogin: false,
    };
  } finally {
    // Close the browser session after inspection
    await closeSession(session.id, userId).catch(() => {});
  }
}
