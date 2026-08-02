/**
 * Persistent workspace service for Terminal V1.
 *
 * Replaces the in-memory Map and .workspaces.json file from the legacy
 * terminal-server. Workspaces are stored in Supabase and backed by
 * Docker volumes for persistent storage.
 */

import { randomUUID } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Workspace, WorkspaceState } from "./types";

// ─── Database row type ───────────────────────────────────────────

interface WorkspaceRow {
  workspace_id: string;
  user_id: string;
  project_id: string;
  sandbox_provider: string;
  current_sandbox_id: string | null;
  storage_volume_id: string | null;
  git_source: "github" | "blank";
  git_owner: string | null;
  git_repo: string | null;
  git_branch: string | null;
  last_commit_sha: string | null;
  state: WorkspaceState;
  failure_reason: string | null;
  storage_usage_bytes: number;
  created_at: string;
  updated_at: string;
  last_active_at: string;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    projectId: row.project_id,
    sandboxProvider: row.sandbox_provider,
    currentSandboxId: row.current_sandbox_id,
    storageVolumeId: row.storage_volume_id,
    gitSource: row.git_source,
    gitOwner: row.git_owner,
    gitRepo: row.git_repo,
    gitBranch: row.git_branch,
    lastCommitSha: row.last_commit_sha,
    state: row.state,
    failureReason: row.failure_reason,
    storageUsageBytes: Number(row.storage_usage_bytes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
  };
}

// ─── Workspace service ───────────────────────────────────────────

export interface CreateWorkspaceInput {
  userId: string;
  projectId: string;
  gitSource: "github" | "blank";
  gitOwner?: string;
  gitRepo?: string;
  gitBranch?: string;
  githubToken?: string | null;
}

export interface UpdateWorkspaceInput {
  state?: WorkspaceState;
  currentSandboxId?: string | null;
  storageVolumeId?: string | null;
  lastCommitSha?: string | null;
  storageUsageBytes?: number;
  failureReason?: string | null;
}

export class WorkspaceService {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client =
      client ??
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
        { auth: { persistSession: false } },
      );
  }

  /**
   * Create a new workspace record.
   * If a workspace already exists for this user+project, return it.
   */
  async create(input: CreateWorkspaceInput): Promise<Workspace> {
    // Check if workspace already exists for this user+project
    const existing = await this.getByUserAndProject(input.userId, input.projectId);
    if (existing && existing.state !== "deleted") {
      return existing;
    }

    const workspaceId = `ws-${randomUUID()}`;
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .from("terminal_workspaces")
      .insert({
        workspace_id: workspaceId,
        user_id: input.userId,
        project_id: input.projectId,
        sandbox_provider: "managed-sandbox",
        git_source: input.gitSource,
        git_owner: input.gitOwner ?? null,
        git_repo: input.gitRepo ?? null,
        git_branch: input.gitBranch ?? null,
        state: "initial",
        created_at: now,
        updated_at: now,
        last_active_at: now,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create workspace: ${error.message}`);
    return rowToWorkspace(data as WorkspaceRow);
  }

  /**
   * Get a workspace by its ID.
   */
  async getById(workspaceId: string): Promise<Workspace | null> {
    const { data, error } = await this.client
      .from("terminal_workspaces")
      .select("*")
      .eq("workspace_id", workspaceId)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found
      throw new Error(`Failed to get workspace: ${error.message}`);
    }

    return rowToWorkspace(data as WorkspaceRow);
  }

  /**
   * Get a workspace by user ID and project ID.
   */
  async getByUserAndProject(userId: string, projectId: string): Promise<Workspace | null> {
    const { data, error } = await this.client
      .from("terminal_workspaces")
      .select("*")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Failed to get workspace: ${error.message}`);
    if (!data) return null;

    return rowToWorkspace(data as WorkspaceRow);
  }

  /**
   * Get all workspaces for a user.
   */
  async listByUser(userId: string): Promise<Workspace[]> {
    const { data, error } = await this.client
      .from("terminal_workspaces")
      .select("*")
      .eq("user_id", userId)
      .neq("state", "deleted")
      .order("last_active_at", { ascending: false });

    if (error) throw new Error(`Failed to list workspaces: ${error.message}`);

    return (data as WorkspaceRow[]).map(rowToWorkspace);
  }

  /**
   * Update a workspace's state and metadata.
   */
  async update(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (input.state !== undefined) update.state = input.state;
    if (input.currentSandboxId !== undefined) update.current_sandbox_id = input.currentSandboxId;
    if (input.storageVolumeId !== undefined) update.storage_volume_id = input.storageVolumeId;
    if (input.lastCommitSha !== undefined) update.last_commit_sha = input.lastCommitSha;
    if (input.storageUsageBytes !== undefined) update.storage_usage_bytes = input.storageUsageBytes;
    if (input.failureReason !== undefined) update.failure_reason = input.failureReason;

    const { data, error } = await this.client
      .from("terminal_workspaces")
      .update(update)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update workspace: ${error.message}`);
    return rowToWorkspace(data as WorkspaceRow);
  }

  /**
   * Mark a workspace as cloning (GitHub repo is being cloned).
   */
  async markCloning(workspaceId: string): Promise<Workspace> {
    return this.update(workspaceId, { state: "cloning" });
  }

  /**
   * Mark a workspace as ready (clone complete, sandbox can be created).
   */
  async markReady(workspaceId: string, commitSha?: string): Promise<Workspace> {
    return this.update(workspaceId, {
      state: "ready",
      lastCommitSha: commitSha ?? null,
    });
  }

  /**
   * Mark a workspace as errored.
   */
  async markError(workspaceId: string, reason: string): Promise<Workspace> {
    return this.update(workspaceId, {
      state: "error",
      failureReason: reason,
    });
  }

  /**
   * Soft-delete a workspace (state = deleted, data preserved for grace period).
   */
  async softDelete(workspaceId: string): Promise<Workspace> {
    return this.update(workspaceId, {
      state: "deleted",
      currentSandboxId: null,
    });
  }

  /**
   * Update last active timestamp (called on terminal activity).
   */
  async touch(workspaceId: string): Promise<void> {
    await this.client
      .from("terminal_workspaces")
      .update({ last_active_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);
  }

  /**
   * Update storage usage (called periodically by a cleanup job).
   */
  async updateStorageUsage(workspaceId: string, bytes: number): Promise<void> {
    await this.client
      .from("terminal_workspaces")
      .update({ storage_usage_bytes: bytes })
      .eq("workspace_id", workspaceId);
  }

  /**
   * Find workspaces that have been idle for longer than the threshold.
   * Used by the cleanup job to stop idle sandboxes.
   */
  async findIdleWorkspaces(thresholdMinutes: number): Promise<Workspace[]> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();
    const { data, error } = await this.client
      .from("terminal_workspaces")
      .select("*")
      .lt("last_active_at", threshold)
      .neq("state", "deleted")
      .not("current_sandbox_id", "is", null);

    if (error) throw new Error(`Failed to find idle workspaces: ${error.message}`);

    return (data as WorkspaceRow[]).map(rowToWorkspace);
  }
}
