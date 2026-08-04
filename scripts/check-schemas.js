// Check actual table schemas
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

async function main() {
  const envContent = fs.readFileSync(".env.local", "utf8");
  const getEnv = (key) => {
    const match = envContent.match(new RegExp(`${key}=(.+)`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  };
  
  const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
  
  // Get table info by trying to select with errors
  const tables = ["integration_accounts", "integration_projects", "projects", "github_installations"];
  
  for (const table of tables) {
    console.log(`\n=== ${table} ===`);
    // Insert a dummy row to see what columns are required
    const { data, error } = await supabase.from(table).select("*").limit(1);
    if (error) {
      console.log("Error:", error.message);
    } else if (data && data[0]) {
      console.log("Columns:", Object.keys(data[0]).join(", "));
    } else {
      console.log("Empty table — trying insert to see required columns");
      const { error: insErr } = await supabase.from(table).insert({}).select();
      if (insErr) {
        console.log("Insert error:", insErr.message);
      }
    }
  }
  
  // Also check the legacy project that exists
  const { data: proj } = await supabase.from("projects").select("*").limit(1);
  if (proj?.[0]) {
    console.log("\n=== projects sample row ===");
    console.log(JSON.stringify(proj[0], null, 2));
  }
}

main().catch(console.error);
