const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const envContent = fs.readFileSync(".env.local", "utf8");
const getEnv = (key) => {
  const m = envContent.match(new RegExp(key + "=(.+)", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const ownerId = "10a18d43-5449-498a-8a98-82b74a13045b";

async function main() {
  const { data: accs } = await supabase.from("integration_accounts").select("*").eq("provider", "vercel");
  const vercelId = accs[0].id;
  
  const { data, error } = await supabase
    .from("integration_projects")
    .insert({
      user_id: ownerId,
      integration_account_id: vercelId,
      provider: "vercel",
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
    const { data: d2, error: e2 } = await supabase
      .from("integration_projects")
      .insert({
        user_id: ownerId,
        integration_account_id: vercelId,
        provider: "vercel",
        repository_full_name: "LabsConnected/litlabs-website",
      })
      .select();
    if (e2) console.log("Error 2:", e2.message);
    else console.log("Inserted:", JSON.stringify(d2));
  } else {
    console.log("Inserted:", JSON.stringify(data));
  }
  
  const { data: all } = await supabase.from("integration_projects").select("*");
  console.log("integration_projects:", all?.length, "rows");
  all?.forEach(p => console.log("  ", p.repository_full_name, "vercel:", p.vercel_project_id, "status:", p.vercel_status));
}
main().catch(console.error);
