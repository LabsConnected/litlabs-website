import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { RunReceiptClient } from "./RunReceiptClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ runId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { runId } = await params;
  const { data: run } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select("prompt, status")
    .eq("id", runId)
    .maybeSingle();

  if (!run) {
    return { title: "Run not found — LiTTree Lab Studios" };
  }

  return {
    title: `Run ${runId.slice(0, 8)} — LiTTree Lab Studios`,
    description: run.prompt.slice(0, 160),
  };
}

export default async function RunReceiptPage({ params }: PageProps) {
  const { runId } = await params;

  const { data: run } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select(`
      id, user_id, agent_id, project_id, prompt, status,
      plan, files_changed, validation_result,
      preview_url, preview_status,
      deployment_url, deployment_status, deployment_provider, deployment_error,
      error_code, error_message, checkpoint_id,
      queued_at, completed_at, created_at
    `)
    .eq("id", runId)
    .maybeSingle();

  if (!run) {
    notFound();
  }

  // Fetch agent name
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("name, slug")
    .eq("id", run.agent_id)
    .maybeSingle();

  // Fetch approvals
  const { data: approvals } = await supabaseAdmin
    .from("revenue_agent_approvals")
    .select("id, approval_type, status, created_at, resolved_at, summary")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  // Fetch run events
  const { data: events } = await supabaseAdmin
    .from("revenue_agent_run_events")
    .select("event_type, event_data, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true })
    .limit(100);

  // Fetch deployments
  const { data: deployments } = await supabaseAdmin
    .from("revenue_deployments")
    .select("id, provider, provider_deployment_id, status, preview_url, production_url, created_at, completed_at, error_message")
    .eq("agent_run_id", runId)
    .order("created_at", { ascending: false });

  return (
    <RunReceiptClient
      run={{
        id: run.id,
        prompt: run.prompt,
        status: run.status,
        plan: run.plan as { summary?: string; steps?: { description: string; tool: string }[] } | null,
        files_changed: (run.files_changed as string[] | null) ?? [],
        validation_result: run.validation_result as { buildOk?: boolean; testOk?: boolean; errors?: string[] } | null,
        preview_url: run.preview_url,
        preview_status: run.preview_status,
        deployment_url: run.deployment_url,
        deployment_status: run.deployment_status,
        deployment_provider: run.deployment_provider,
        deployment_error: run.deployment_error,
        error_code: run.error_code,
        error_message: run.error_message,
        checkpoint_id: run.checkpoint_id,
        queued_at: run.queued_at,
        completed_at: run.completed_at,
        created_at: run.created_at,
      }}
      agent={agent ? { name: agent.name, slug: agent.slug } : null}
      approvals={(approvals ?? []).map((a) => ({
        id: a.id,
        approval_type: a.approval_type,
        status: a.status,
        created_at: a.created_at,
        resolved_at: a.resolved_at,
      }))}
      events={(events ?? []).map((e) => ({
        event_type: e.event_type,
        event_data: e.event_data as Record<string, unknown>,
        created_at: e.created_at,
      }))}
      deployments={(deployments ?? []).map((d) => ({
        id: d.id,
        provider: d.provider,
        provider_deployment_id: d.provider_deployment_id,
        status: d.status,
        preview_url: d.preview_url,
        production_url: d.production_url,
        created_at: d.created_at,
        completed_at: d.completed_at,
        error_message: d.error_message,
      }))}
    />
  );
}
