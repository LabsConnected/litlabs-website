// Connect all workspace integrations via Supabase
// This inserts records for GitHub repo, Vercel project, and Supabase project

// Read-only: this script only queries the public system-health endpoint.
// It previously carried an unused Supabase URL fallback to production — removed.

async function main() {
  // Check current state via the API
  console.log("Checking current connection state...");
  
  // We'll use the production API endpoint
  const healthRes = await fetch("https://litlabs.net/api/system-health", {
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
