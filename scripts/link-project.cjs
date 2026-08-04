// Link integration project to Vercel account
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

async function main() {
  const envContent = fs.readFileSync(".env.local", "utf8");
  const getEnv = (key) => {
    const match = envContent.match(new RegExp(`${key}=(.+)`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  
  const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
  const ownerId = "10a18d43-5449-498a-8a98-82b74a13045b";
  
  // Get the Vercel account ID
  const { data: accounts } = await supabase
    .from("integration_accounts")
    .select("*")
    .eq("provider", "vercel");
  
  const vercelAccount = accounts?.[0];
  console.log("Vercel account:", vercelAccount?.id);
  
  if (!vercelAccount) {
    console.log("No Vercel account found");
    return;
  }
  
  // Insert integration project with the account ID
  const { data, error } = await supabase
    .from("integration_projects")
    .insert({
      user_id: ownerId,
      integration_account_id: vercelAccount.id,
      repository_full_name: "LabsConnected/litlabs-website",
      repository_html_url: "https://github.com/LabsConnected/litlabs-website",
      vercel_project_id: "prj_EnE4JStJUENM89PWov574Y9q7mTy",
      vercel_deployment_url: "https://litlabs.net",
      vercel_production_url: "https://litlabs.net",
      vercel_status: "ready",
      sync_status: "connected",
    })
    .select();
  
  if (error) {
    console.log("Error:", error.message);
    // Try with even more minimal columns
    const { data: d2, error: e2 } = await supabase
      .from("integration_projects")
      .insert({
        user_id: ownerId,
        integration_account_id: vercelAccount.id,
        repository_full_name: "LabsConnected/litlabs-website",
      })
      .select();
    if (e2) console.log("Error 2:", e2.message);
    else console.log("Inserted:", d2);
  } else {
    console.log("Inserted:", data);
  }
  
  // Final verify
  console.log("\n=== Final state ===");
  const { data: allAccounts } = await supabase.from("integration_accounts").select("*");
  console.log("integration_accounts:", allAccounts?.length, "rows");
  allAccounts?.forEach(a => console.log(`  ${a.provider}: ${a.provider_account_name} (id: ${a.id})`));
  
  const { data: allProjects } = await supabase.from("integration_projects").select("*");
  console.log("integration_projects:", allProjects?.length, "rows");
  allProjects?.forEach(p => console.log(`  ${p.repository_full_name}: vercel=${p.vercel_project_id} status=${p.vercel_status}`));
  
  const { data: legacy } = await supabase.from("projects").select("repository_full_name, connection_status, vercel_project_id, status").eq("repository_full_name", "LabsConnected/litlabs-website");
  console.log("legacy project:", legacy?.[0]);
}

main().catch(console.error);
