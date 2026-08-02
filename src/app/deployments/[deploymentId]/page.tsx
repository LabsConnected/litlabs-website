import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase";
import { DeploymentReceiptClient } from "./DeploymentReceiptClient";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ deploymentId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { deploymentId } = await params;
  const { data: dep } = await supabaseAdmin
    .from("revenue_deployments")
    .select("id, status, provider")
    .eq("id", deploymentId)
    .maybeSingle();

  if (!dep) {
    return { title: "Deployment not found — LiTTree Lab Studios" };
  }

  return {
    title: `Deployment ${deploymentId.slice(0, 8)} — LiTTree Lab Studios`,
    description: `${dep.provider} deployment — ${dep.status}`,
  };
}

export default async function DeploymentReceiptPage({ params }: PageProps) {
  const { deploymentId } = await params;

  const { data: deployment } = await supabaseAdmin
    .from("revenue_deployments")
    .select(`
      id, user_id, project_id, agent_run_id,
      provider, provider_deployment_id, environment,
      status, preview_url, production_url,
      source_revision, checkpoint_id,
      error_code, error_message, metadata,
      created_at, updated_at, completed_at
    `)
    .eq("id", deploymentId)
    .maybeSingle();

  if (!deployment) {
    notFound();
  }

  return <DeploymentReceiptClient deployment={deployment} />;
}
