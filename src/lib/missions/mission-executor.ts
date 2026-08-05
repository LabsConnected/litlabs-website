/**
 * Mission Execution Service — the server-side boundary.
 *
 * This is the ONE service that MissionForge calls. It coordinates
 * LLM calls, file operations, approvals, validation, and checkpoints.
 * The browser never coordinates these APIs directly.
 *
 * The initial capability is a safe vertical slice:
 *   inspect files → propose one text-file modification → generate patch
 *   → produce diff → wait for approval → apply patch → validate → checkpoint
 */

import { generateText } from "@/lib/llm";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { logFileOperation } from "@/lib/file-audit";
import {
  createMission,
  getMission,
  updateMissionStatus,
  createRun,
  updateRunStatus,
  createStep,
  updateStepStatus,
  createApproval,
  resolveApproval,
  createValidationResult,
  updateValidationResult,
  createCheckpoint,
  type Mission,
  type MissionRun,
  type MissionApproval,
  type ValidationResult,
} from "./mission-repository";

const TERMINAL_BASE = () => {
  const raw = process.env.TERMINAL_SERVER_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
    "";
  return raw && !raw.includes("localhost")
    ? raw
    : "https://litlabs-terminal-server-production-0be1.up.railway.app";
};

/**
 * Create a mission for a project.
 */
export async function createMissionForProject(input: {
  projectId: string;
  userId: string;
  name: string;
  description?: string;
  graph?: Record<string, unknown>;
}): Promise<Mission> {
  return createMission(input);
}

/**
 * Start a mission run. Creates a run record and begins execution.
 * For the initial vertical slice, this executes a simple "propose change" flow.
 */
export async function startMissionRun(
  missionId: string,
  projectId: string,
  userId: string,
  prompt: string,
): Promise<{ run: MissionRun; approval: MissionApproval | null }> {
  // Verify project and workspace
  const { workspaceId } = await verifyProjectWorkspace(projectId, userId);

  // Verify mission ownership
  const mission = await getMission(missionId, userId);
  if (!mission) throw new Error("Mission not found");
  if (mission.projectId !== projectId) throw new Error("Mission does not belong to this project");

  // Create the run
  const run = await createRun(missionId, projectId, userId);
  await updateRunStatus(run.id, userId, "running");
  await updateMissionStatus(missionId, userId, "running");

  try {
    // Step 1: Inspect files
    const inspectStep = await createStep({
      runId: run.id,
      missionId,
      nodeId: "inspect",
      nodeType: "action",
      title: "Inspect project files",
      sequenceOrder: 0,
    });
    await updateStepStatus(inspectStep.id, "running");

    const fileTree = await listWorkspaceFiles(workspaceId, userId, ".");
    await updateStepStatus(inspectStep.id, "completed", { fileTree });

    // Step 2: Propose a change via LLM
    const proposeStep = await createStep({
      runId: run.id,
      missionId,
      nodeId: "propose",
      nodeType: "assistant",
      title: "LiTT proposes a file change",
      sequenceOrder: 1,
      input: { prompt },
    });
    await updateStepStatus(proposeStep.id, "running");

    const proposal = await generateChangeProposal(prompt, fileTree, workspaceId, userId);
    await updateStepStatus(proposeStep.id, "completed", { proposal });

    // Step 3: Create approval with diff
    const approvalStep = await createStep({
      runId: run.id,
      missionId,
      nodeId: "approval",
      nodeType: "approval",
      title: "Review and approve change",
      sequenceOrder: 2,
    });
    await updateStepStatus(approvalStep.id, "waiting_approval");

    // Read the original file content for diff
    const originalContent = await readWorkspaceFile(workspaceId, userId, proposal.filePath);
    const diff = generateDiff(proposal.filePath, originalContent, proposal.newContent);
    const patch = proposal.newContent;

    const approval = await createApproval({
      runId: run.id,
      stepId: approvalStep.id,
      missionId,
      projectId,
      userId,
      actionType: "file_write",
      actionPayload: { filePath: proposal.filePath },
      affectedFiles: [proposal.filePath],
      diff,
      patch,
      riskLevel: proposal.riskLevel,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
    });

    // Pause the run — waiting for approval
    await updateRunStatus(run.id, userId, "paused");

    return { run, approval };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mission execution failed";
    await updateRunStatus(run.id, userId, "failed", message);
    await updateMissionStatus(missionId, userId, "failed");
    throw err;
  }
}

/**
 * Resolve an approval. If approved, applies the patch, runs validation,
 * and creates a checkpoint. If denied, marks the step as skipped.
 *
 * This is server-enforced — a client-side state change alone cannot
 * permit execution.
 */
export async function resolveMissionApproval(
  approvalId: string,
  userId: string,
  decision: "approved" | "denied",
): Promise<{
  applied: boolean;
  validationResults: ValidationResult[];
  checkpoint: { gitSha: string; label: string } | null;
}> {
  const approval = await resolveApproval(approvalId, userId, decision);
  if (!approval) throw new Error("Approval not found or already resolved");

  if (decision === "denied") {
    await updateStepStatus(approval.stepId, "skipped", { decision: "denied" });
    await updateRunStatus(approval.runId, userId, "completed", null);
    return { applied: false, validationResults: [], checkpoint: null };
  }

  // Approved — apply the patch
  const { workspaceId, workspaceRoot, project } = await verifyProjectWorkspace(
    approval.projectId,
    userId,
  );

  await updateStepStatus(approval.stepId, "running");

  // Apply the file change
  const filePath = (approval.actionPayload as { filePath?: string }).filePath;
  if (!filePath || !approval.patch) {
    throw new Error("Invalid approval payload — missing filePath or patch");
  }

  await writeWorkspaceFile(workspaceId, userId, filePath, approval.patch);
  // Audit log the AI-driven file write (approved via the mission approval flow)
  await logFileOperation({
    userId,
    projectId: approval.projectId,
    workspaceId,
    action: "write",
    path: filePath,
    contentLength: approval.patch.length,
    source: "mission",
    approvalId: approval.id,
    ok: true,
  }).catch(() => {});
  await updateStepStatus(approval.stepId, "completed", { applied: true });

  // Run validation
  const validationResults = await runValidation(
    approval.runId,
    approval.projectId,
    userId,
    workspaceId,
    workspaceRoot,
    project.framework,
    project.packageManager,
  );

  // Create a Git-backed checkpoint
  let checkpoint: { gitSha: string; label: string } | null = null;
  try {
    const gitSha = await createGitCheckpoint(workspaceId, userId, `Mission: ${approval.actionType}`);
    const cp = await createCheckpoint({
      projectId: approval.projectId,
      userId,
      gitSha,
      label: `Checkpoint after approval`,
      missionRunId: approval.runId,
    });
    checkpoint = { gitSha: cp.gitSha, label: cp.label };
  } catch (err) {
    // Checkpoint failure is non-fatal — the change was already applied
    console.error("Checkpoint creation failed:", err);
  }

  // Mark run as completed
  await updateRunStatus(approval.runId, userId, "completed", null);
  await updateMissionStatus(approval.missionId, userId, "completed");

  return { applied: true, validationResults, checkpoint };
}

// ─── Helper functions ───────────────────────────────────────────

async function listWorkspaceFiles(workspaceId: string, userId: string, path: string) {
  const { token } = createTerminalToken(userId);
  const resp = await fetch(
    `${TERMINAL_BASE()}/ws-files?path=${encodeURIComponent(path)}`,
    { headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceId } },
  );
  if (!resp.ok) throw new Error(`Failed to list files: ${resp.status}`);
  return (await resp.json()) as { entries: { name: string; type: string }[] };
}

async function readWorkspaceFile(workspaceId: string, userId: string, filePath: string): Promise<string> {
  const { token } = createTerminalToken(userId);
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({ path: filePath }),
  });
  if (!resp.ok) {
    if (resp.status === 404) return ""; // New file
    throw new Error(`Failed to read file: ${resp.status}`);
  }
  const data = (await resp.json()) as { content: string };
  return data.content;
}

async function writeWorkspaceFile(workspaceId: string, userId: string, filePath: string, content: string): Promise<void> {
  const { token } = createTerminalToken(userId);
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files/write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!resp.ok) throw new Error(`Failed to write file: ${resp.status}`);
}

interface ChangeProposal {
  filePath: string;
  newContent: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
}

async function generateChangeProposal(
  prompt: string,
  fileTree: { entries: { name: string; type: string }[] },
  workspaceId: string,
  userId: string,
): Promise<ChangeProposal> {
  // Read the first file (or index.html) to provide context
  const fileList = fileTree.entries
    .filter((e) => e.type === "file")
    .map((e) => e.name);
  const targetFile = fileList.find((f) => f === "index.html") || fileList[0] || "index.html";

  const existingContent = await readWorkspaceFile(workspaceId, userId, targetFile);

  // Use LLM to generate a proposed change
  const systemPrompt = `You are LiTT, an AI coding assistant. The user wants you to make a small change to their project.
You must respond with a JSON object containing:
- filePath: the path to the file to modify
- newContent: the COMPLETE new file content (not a diff)
- description: a brief description of the change
- riskLevel: "low", "medium", or "high"

Only modify ONE file. Keep changes small and safe. Respond with valid JSON only.`;

  const userPrompt = `Project files: ${fileList.join(", ")}

Current content of ${targetFile}:
\`\`\`
${existingContent.slice(0, 4000)}
\`\`\`

User request: ${prompt}

Respond with the JSON object describing the file change.`;

  const result = await generateText(userPrompt, { task: "code" }, systemPrompt);

  // Parse the JSON response
  try {
    // Extract JSON from the response (handle markdown code fences)
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const proposal = JSON.parse(jsonMatch[0]) as ChangeProposal;
    return {
      filePath: proposal.filePath || targetFile,
      newContent: proposal.newContent || existingContent,
      description: proposal.description || "File modification",
      riskLevel: proposal.riskLevel || "low",
    };
  } catch {
    // Fallback: make a minimal safe change
    return {
      filePath: targetFile,
      newContent: existingContent + "\n<!-- LiTT was here -->\n",
      description: "Minimal placeholder change (LLM parsing failed)",
      riskLevel: "low",
    };
  }
}

function generateDiff(filePath: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diffLines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  const maxLines = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      continue;
    }
    if (oldLine !== undefined) {
      diffLines.push(`-${oldLine}`);
    }
    if (newLine !== undefined) {
      diffLines.push(`+${newLine}`);
    }
  }

  return diffLines.join("\n");
}

async function runValidation(
  runId: string,
  projectId: string,
  userId: string,
  workspaceId: string,
  workspaceRoot: string,
  framework: string | null,
  packageManager: string | null,
): Promise<ValidationResult[]> {
  const commands: { cmd: string; label: string }[] = [];

  // Determine which commands to run based on project type
  if (packageManager && packageManager !== "none") {
    const pm = packageManager;
    commands.push({ cmd: `${pm} install`, label: "install" });
    if (framework === "nextjs" || framework === "vite") {
      commands.push({ cmd: `${pm} run build`, label: "build" });
      commands.push({ cmd: `${pm} run lint`, label: "lint" });
    }
  }

  // For static sites, no build step needed
  if (commands.length === 0) {
    return [];
  }

  const results: ValidationResult[] = [];

  for (const { cmd } of commands) {
    const result = await createValidationResult({
      runId,
      projectId,
      userId,
      command: cmd,
    });

    try {
      // Execute the command in the workspace via terminal-server
      const execResp = await fetch(`${TERMINAL_BASE()}/internal/workspace/${workspaceId}/exec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Service-Key": process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "",
        },
        body: JSON.stringify({ command: cmd, userId }),
      });

      if (!execResp.ok) {
        const updated = await updateValidationResult(result.id, {
          status: "failed",
          stderr: `Command execution failed: ${execResp.status}`,
          exitCode: -1,
        });
        if (updated) results.push(updated);
        continue;
      }

      const execData = (await execResp.json()) as {
        exitCode: number;
        stdout: string;
        stderr: string;
        durationMs: number;
      };

      const updated = await updateValidationResult(result.id, {
        status: execData.exitCode === 0 ? "passed" : "failed",
        exitCode: execData.exitCode,
        stdout: execData.stdout?.slice(0, 100000) ?? null,
        stderr: execData.stderr?.slice(0, 100000) ?? null,
        durationMs: execData.durationMs ?? null,
      });
      if (updated) results.push(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Validation failed";
      const updated = await updateValidationResult(result.id, {
        status: "failed",
        stderr: message,
        exitCode: -1,
      });
      if (updated) results.push(updated);
    }
  }

  return results;
}

async function createGitCheckpoint(workspaceId: string, userId: string, message: string): Promise<string> {
  // Use terminal-server's exec endpoint to run git commands in the workspace
  const internalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
  if (internalKey.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const execInWorkspace = async (command: string) => {
    const resp = await fetch(`${TERMINAL_BASE()}/internal/workspace/${workspaceId}/exec`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": internalKey,
      },
      body: JSON.stringify({ command, userId }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "Unknown error");
      throw new Error(`Git command failed: ${text}`);
    }
    return (await resp.json()) as { exitCode: number; stdout: string; stderr: string };
  };

  await execInWorkspace("git add .");
  await execInWorkspace(`git commit -m "${message.replace(/"/g, '\\"')}"`);
  const shaResult = await execInWorkspace("git rev-parse HEAD");
  return shaResult.stdout.trim();
}
