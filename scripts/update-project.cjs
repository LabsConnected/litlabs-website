const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const envContent = fs.readFileSync(".env.local", "utf8");
const getEnv = (key) => {
  const m = envContent.match(new RegExp(key + "=(.+)", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function main() {
  // Update the integration project with Vercel info
  const { data, error } = await supabase
    .from("integration_projects")
    .update({
      repository_html_url: "https://github.com/LabsConnected/litlabs-website",
      vercel_project_id: "prj_EnE4JStJUENM89PWov574Y9q7mTy",
      vercel_deployment_url: "https://litlabs.net",
      vercel_production_url: "https://litlabs.net",
      vercel_status: "ready",
      sync_status: "synced",
      working_branch: "main",
      default_branch: "main",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("repository_full_name", "LabsConnected/litlabs-website")
    .select();
  
  if (error) {
    console.log("Error:", error.message);
    // Try different sync_status values
    for (const status of ["connected", "active", "ok", "complete", "done"]) {
      const { data: d2, error: e2 } = await supabase
        .from("integration_projects")
        .update({
          vercel_project_id: "prj_EnE4JStJUENM89PWov574Y9q7mTy",
          vercel_deployment_url: "https://litlabs.net",
          vercel_production_url: "https://litlabs.net",
          vercel_status: "ready",
          sync_status: status,
          repository_html_url: "https://github.com/LabsConnected/litlabs-website",
          working_branch: "main",
          last_synced_at: new Date().toISOString(),
        })
        .eq("repository_full_name", "LabsConnected/litlabs-website")
        .select();
      if (e2) continue;
      console.log(`Worked with sync_status="${status}":`, JSON.stringify(d2));
      break;
    }
  } else {
    console.log("Updated:", JSON.stringify(data));
  }
  
  // Final verify
  console.log("\n=== FINAL STATE ===");
  const { data: accounts } = await supabase.from("integration_accounts").select("*");
  console.log("integration_accounts:", accounts?.length, "rows");
  accounts?.forEach(a => console.log(`  ${a.provider}: ${a.provider_account_name}`));
  
  const { data: projects } = await supabase.from("integration_projects").select("*");
  console.log("integration_projects:", projects?.length, "rows");
  projects?.forEach(p => console.log(`  ${p.repository_full_name}: vercel=${p.vercel_project_id} status=${p.vercel_status} sync=${p.sync_status}`));
  
  const { data: installations } = await supabase.from("github_installations").select("*");
  console.log("github_installations:", installations?.length, "rows");
  
  const { data: legacy } = await supabase.from("projects").select("repository_full_name, connection_status, vercel_project_id, status").eq("repository_full_name", "LabsConnected/litlabs-website");
  console.log("legacy project:", JSON.stringify(legacy?.[0]));
}

main().catch(console.error);
