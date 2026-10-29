// Connect all workspace integrations via Supabase
// This inserts records for GitHub repo, Vercel project, and Supabase project

const API_URL = process.env.LITLABS_API_URL || "http://localhost:3001";

// We need the service role key to insert records
// Let's try using the API instead

async function main() {
  // Check current state via the API
  console.log("Checking current connection state...");
  
  // Check the API endpoint (defaults to the local dev server — set
  // LITLABS_API_URL to check another environment)
  const healthRes = await fetch(`${API_URL}/api/system-health`, {
    headers: { "Cache-Control": "no-store" }
  });
  
  if (healthRes.ok) {
    const health = await healthRes.json();
    console.log("\n=== Current Workspace Connections ===");
    health.workspace?.forEach(w => {
      console.log(`  ${w.label}: ${w.state} — ${w.detail}`);
    });
    console.log("\n=== AI Providers ===");
    health.ai?.forEach(a => {
      console.log(`  ${a.label}: ${a.state} — ${a.detail}`);
    });
  } else {
    console.log("Health API status:", healthRes.status);
  }
}

main().catch(console.error);
