// Connect workspace with correct schemas
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

async function main() {
  const envContent = fs.readFileSync(".env.local", "utf8");
  const getEnv = (key) => {
    const match = envContent.match(new RegExp(`${key}=(.+)`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  
  const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
  
  // Owner user
  const ownerId = "10a18d43-5449-498a-8a98-82b74a13045b"; // laidbacknostress4life@gmail.com
  const ownerClerkId = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF";
  
  // === 1. Update legacy project to connected ===
  console.log("--- Updating legacy project ---");
  const { data: projUpdate, error: projErr } = await supabase
    .from("projects")
    .update({
      connection_status: "connected",
      connected_at: new Date().toISOString(),
      status: "active",
      vercel_project_id: "prj_EnE4JStJUENM89PWov574Y9q7mTy",
      updated_at: new Date().toISOString(),
    })
    .eq("repository_full_name", "LabsConnected/litlabs-website")
    .select();
  if (projErr) console.log("Error:", projErr.message);
  else console.log("Updated:", projUpdate?.length, "rows");
  
  // === 2. Insert Vercel account — try minimal columns ===
  console.log("\n--- Inserting Vercel account ---");
  const { data: vercelAcc, error: vErr } = await supabase
    .from("integration_accounts")
    .insert({
      user_id: ownerId,
      provider: "vercel",
      provider_account_id: "litlabs",
      provider_account_name: "litlabs.net",
    })
    .select();
  if (vErr) {
    console.log("Error:", vErr.message);
    // Try with different columns
    const { data: v2, error: vErr2 } = await supabase
      .from("integration_accounts")
      .insert({
        user_id: ownerId,
        provider: "vercel",
      })
      .select();
    if (vErr2) console.log("Error 2:", vErr2.message);
    else console.log("Inserted minimal:", v2);
  } else {
    console.log("OK");
  }
  
  // === 3. Insert Supabase account ===
  console.log("\n--- Inserting Supabase account ---");
  const { data: supaAcc, error: sErr } = await supabase
    .from("integration_accounts")
    .insert({
      user_id: ownerId,
      provider: "supabase",
      provider_account_id: "rokbfvuoqildggnhappy",
      provider_account_name: "LiTTree Lab Studios DB",
    })
    .select();
  if (sErr) {
    console.log("Error:", sErr.message);
    const { data: s2, error: sErr2 } = await supabase
      .from("integration_accounts")
      .insert({
        user_id: ownerId,
        provider: "supabase",
      })
      .select();
    if (sErr2) console.log("Error 2:", sErr2.message);
    else console.log("Inserted minimal:", s2);
  } else {
    console.log("OK");
  }
  
  // === 4. Insert integration project ===
  console.log("\n--- Inserting integration project ---");
  const { data: intProj, error: ipErr } = await supabase
    .from("integration_projects")
    .insert({
      user_id: ownerId,
      repository_full_name: "LabsConnected/litlabs-website",
      repository_html_url: "https://github.com/LabsConnected/litlabs-website",
      vercel_project_id: "prj_EnE4JStJUENM89PWov574Y9q7mTy",
      vercel_deployment_url: "https://litlabs.net",
      vercel_production_url: "https://litlabs.net",
      vercel_status: "ready",
      sync_status: "connected",
    })
    .select();
  if (ipErr) {
    console.log("Error:", ipErr.message);
    // Try minimal
    const { data: ip2, error: ipErr2 } = await supabase
      .from("integration_projects")
      .insert({
        user_id: ownerId,
        repository_full_name: "LabsConnected/litlabs-website",
      })
      .select();
    if (ipErr2) console.log("Error 2:", ipErr2.message);
    else console.log("Inserted minimal:", ip2);
  } else {
    console.log("OK");
  }
  
  // === Verify ===
  console.log("\n=== Final state ===");
  const { data: accounts } = await supabase.from("integration_accounts").select("*");
  console.log("integration_accounts:", accounts?.length, "rows");
  accounts?.forEach(a => console.log(`  ${a.provider}: ${a.provider_account_name}`));
  
  const { data: projects } = await supabase.from("integration_projects").select("*");
  console.log("integration_projects:", projects?.length, "rows");
  projects?.forEach(p => console.log(`  ${p.repository_full_name}: vercel=${p.vercel_project_id}`));
  
  const { data: legacy } = await supabase.from("projects").select("repository_full_name, connection_status, vercel_project_id").eq("repository_full_name", "LabsConnected/litlabs-website");
  console.log("legacy project:", legacy?.[0]?.connection_status, "vercel:", legacy?.[0]?.vercel_project_id);
}

main().catch(console.error);
