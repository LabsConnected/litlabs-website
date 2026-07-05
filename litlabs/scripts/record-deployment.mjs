#!/usr/bin/env node
// Record a deployment from the deploy-agent shell script into Supabase
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const status = args[0] || "live";
const branch = args[1] || "main";
const commitSha = args[2] || "";
const environment = args[3] || "production";
const deployUrl = args[4] || "";
const error = args[5] || "";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase env vars; deployment not recorded.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data, error: dbError } = await supabase
    .from("deployments")
    .insert({
      branch,
      commit_sha: commitSha || null,
      environment,
      status,
      deploy_url: deployUrl || null,
      source: "deploy-agent",
      metadata: {
        recorded_by: "deploy-agent",
        ...(error ? { error } : {}),
      },
    })
    .select()
    .single();

  if (dbError) {
    console.error("Failed to record deployment:", dbError.message);
    process.exit(1);
  }

  console.log(JSON.stringify(data));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
