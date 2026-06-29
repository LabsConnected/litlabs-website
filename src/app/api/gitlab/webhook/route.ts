// GitLab pipeline webhook — records/updates deployment status
import { NextRequest, NextResponse } from "next/server";
import {
  DeploySource,
  inferEnvironment,
  mapGitLabStatus,
  upsertDeploymentByPipeline,
} from "@/lib/deployments";
import { notifyDeployment } from "@/lib/discord";

export const dynamic = "force-dynamic";

interface GitLabPipelinePayload {
  object_kind: "pipeline";
  object_attributes: {
    id: number;
    ref: string;
    sha: string;
    status: string;
    detailed_status?: string;
    source?: string;
    created_at?: string;
    finished_at?: string;
    duration?: number;
  };
  project?: {
    id?: number;
    name?: string;
    web_url?: string;
  };
  merge_request?: {
    iid?: number;
    source_branch?: string;
    target_branch?: string;
  };
  commit?: {
    id?: string;
    message?: string;
    url?: string;
  };
}

function verifyGitLabToken(req: NextRequest): boolean {
  const secret = process.env.GITLAB_WEBHOOK_SECRET;
  if (!secret) return false;
  const token =
    req.headers.get("x-gitlab-token") ||
    req.headers.get("x-gitlab-webhook-secret");
  return token === secret;
}

export async function POST(req: NextRequest) {
  try {
    if (!verifyGitLabToken(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as GitLabPipelinePayload;

    if (body.object_kind !== "pipeline") {
      return NextResponse.json(
        { error: "Only pipeline events are supported" },
        { status: 400 },
      );
    }

    const attrs = body.object_attributes;
    const branch = body.merge_request?.source_branch || attrs.ref || "unknown";
    const commitSha = attrs.sha || body.commit?.id || "";
    const environment = inferEnvironment(branch);
    const status = mapGitLabStatus(attrs.status, body.object_attributes.source);
    const pipelineUrl = body.commit?.url
      ? body.commit.url.replace(/\/commit\//, "/-/commit/")
      : undefined;
    const projectUrl = body.project?.web_url;
    const deployUrl = projectUrl
      ? `${projectUrl}/-/pipelines/${attrs.id}`
      : undefined;

    const deployment = await upsertDeploymentByPipeline(String(attrs.id), {
      branch,
      commit_sha: commitSha,
      environment,
      status,
      pipeline_url: deployUrl,
      deploy_url: pipelineUrl,
      source: "gitlab" as DeploySource,
      metadata: {
        external_id: String(attrs.id),
        project_name: body.project?.name,
        project_id: body.project?.id,
        commit_message: body.commit?.message,
        gitlab_status: attrs.status,
        gitlab_source: attrs.source,
        duration: attrs.duration,
        finished_at: attrs.finished_at,
      },
    });

    // Notify Discord for non-silent transitions
    if (["live", "failed", "cancelled", "deploying"].includes(status)) {
      await notifyDeployment(status, branch, environment, {
        commitSha,
        pipelineUrl: deployUrl,
        deployUrl: pipelineUrl,
      }).catch(() => {
        // Notification failure should not fail the webhook
      });
    }

    return NextResponse.json({ success: true, deployment }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to process webhook", message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ status: "GitLab webhook endpoint ready" });
}
