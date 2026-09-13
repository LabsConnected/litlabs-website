/**
 * Supabase-backed DeploymentStore for user-project deployments.
 *
 * Writes go through the service role (supabaseAdmin) — the tables deny anon
 * and authenticated PostgREST access outright, matching this app's access
 * model. Every row carries user_id + project_id so a deployment is always
 * attributable to an owner, which the shared `deployments` table (LiTT's own
 * CI/CD tracking) cannot express.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import type {
  DeploymentStore,
  DeploymentRecord,
  DeploymentCreateInput,
} from "./deploy-service";
import type { DeploymentStatus } from "./user-deployment";

const TABLE = "project_deployments";
const FILES_TABLE = "project_deployment_files";

interface DeploymentRow {
  id: string;
  user_id: string;
  project_id: string;
  workspace_id: string;
  status: DeploymentStatus;
  target: string;
  public_url: string | null;
  url_verified: boolean;
  file_count: number;
  total_bytes: number;
  content_hash: string | null;
  error_class: string | null;
  error_message: string | null;
}

function rowToRecord(row: DeploymentRow): DeploymentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    status: row.status,
    target: row.target,
    publicUrl: row.public_url,
    urlVerified: row.url_verified,
    fileCount: row.file_count,
    totalBytes: row.total_bytes,
    contentHash: row.content_hash,
    errorClass: row.error_class,
    errorMessage: row.error_message,
  };
}

/** Map the camelCase patch onto column names. */
function patchToRow(patch: Partial<DeploymentRecord>): Record<string, unknown> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.publicUrl !== undefined) row.public_url = patch.publicUrl;
  if (patch.urlVerified !== undefined) row.url_verified = patch.urlVerified;
  if (patch.fileCount !== undefined) row.file_count = patch.fileCount;
  if (patch.totalBytes !== undefined) row.total_bytes = patch.totalBytes;
  if (patch.contentHash !== undefined) row.content_hash = patch.contentHash;
  if (patch.errorClass !== undefined) row.error_class = patch.errorClass;
  if (patch.errorMessage !== undefined) row.error_message = patch.errorMessage;
  return row;
}

function requireDb() {
  if (!supabaseAdmin) {
    throw new Error("Deployment storage is unavailable: database not configured.");
  }
  return supabaseAdmin;
}

export const supabaseDeploymentStore: DeploymentStore = {
  async findReadyByContentHash(projectId, contentHash) {
    const db = requireDb();
    const { data, error } = await db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .eq("content_hash", contentHash)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Deployment lookup failed: ${error.message}`);
    return data ? rowToRecord(data as DeploymentRow) : null;
  },

  async create(input: DeploymentCreateInput) {
    const db = requireDb();
    const { data, error } = await db
      .from(TABLE)
      .insert({
        user_id: input.userId,
        project_id: input.projectId,
        workspace_id: input.workspaceId,
        status: input.status,
        target: input.target,
        content_hash: input.contentHash ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(`Deployment create failed: ${error.message}`);
    return rowToRecord(data as DeploymentRow);
  },

  async update(id, patch) {
    const db = requireDb();
    const { data, error } = await db
      .from(TABLE)
      .update(patchToRow(patch))
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(`Deployment update failed: ${error.message}`);
    return rowToRecord(data as DeploymentRow);
  },

  async putFiles(id, files) {
    const db = requireDb();
    // A deployment snapshot is immutable, so replace rather than merge.
    const { error: deleteError } = await db.from(FILES_TABLE).delete().eq("deployment_id", id);
    if (deleteError) throw new Error(`Deployment file reset failed: ${deleteError.message}`);

    const { error } = await db.from(FILES_TABLE).insert(
      files.map((file) => ({
        deployment_id: id,
        path: file.path,
        content: file.content,
        content_type: file.contentType,
        bytes: file.bytes,
      })),
    );
    if (error) throw new Error(`Deployment file write failed: ${error.message}`);
  },
};

/** One published file, for the public serving route. */
export interface PublishedFile {
  content: string;
  contentType: string;
}

/**
 * Read a single published file for a READY deployment.
 *
 * Only `ready` deployments serve: a building/deploying/failed deployment has
 * no business answering public requests.
 */
export async function readPublishedFile(
  deploymentId: string,
  path: string,
): Promise<PublishedFile | null> {
  if (!supabaseAdmin) return null;

  const { data: deployment, error: deploymentError } = await supabaseAdmin
    .from(TABLE)
    .select("id,status")
    .eq("id", deploymentId)
    .maybeSingle();
  if (deploymentError || !deployment) return null;
  if ((deployment as { status: string }).status !== "ready") return null;

  const { data, error } = await supabaseAdmin
    .from(FILES_TABLE)
    .select("content,content_type")
    .eq("deployment_id", deploymentId)
    .eq("path", path)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as { content: string; content_type: string };
  return { content: row.content, contentType: row.content_type };
}

/**
 * The most recent deployment for a project, whatever its state.
 *
 * Used to report deployment state in the runtime context. Returns null when
 * storage is unavailable or nothing has ever been deployed, so the context
 * degrades to "not_started" rather than guessing.
 */
export async function findLatestDeploymentForProject(
  projectId: string,
  userId: string,
): Promise<DeploymentRecord | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToRecord(data as DeploymentRow);
}
