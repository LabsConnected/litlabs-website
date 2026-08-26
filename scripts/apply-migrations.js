// Apply Supabase migrations using the REST API + service role key
// This approach uses the PostgREST RPC endpoint to execute SQL
// by leveraging the `pg_exec` function if available, or creates
// a temporary function to execute the migration SQL.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rokbfvuoqildggnhappy.supabase.co";
const SERVICE_KEY = process.env.SERVICE_KEY || "";

async function tryRestApi() {
  // Try to execute SQL via the Supabase REST API
  // Method 1: Check if there's a pg_exec or similar function
  const queries = [
    "SELECT 1 as test",
  ];

  for (const q of queries) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pg_exec`, {
        method: "POST",
        headers: {
          "apikey": SERVICE_KEY,
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: q }),
      });
      const text = await res.text();
      console.log(`pg_exec attempt: ${res.status} - ${text.substring(0, 200)}`);
      if (res.ok) return true;
    } catch (e) {
      console.log(`pg_exec error: ${e.message}`);
    }
  }
  return false;
}

async function tryDirectPg() {
  // Try connecting via pg library with various connection strings
  const { Client } = require("pg");
  
  const connectionStrings = [
    // Direct connection with project ref as username
    `postgresql://postgres.rokbfvuoqildggnhappy:${SERVICE_KEY}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    // Try with service role key as password
    `postgresql://postgres:${SERVICE_KEY}@db.rokbfvuoqildggnhappy.supabase.co:5432/postgres`,
  ];

  for (const connStr of connectionStrings) {
    try {
      const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 5000 });
      await client.connect();
      console.log(`Connected via: ${connStr.split("@")[1]?.split("/")[0]}`);
      const res = await client.query("SELECT 1 as test");
      console.log(`Query result:`, res.rows);
      await client.end();
      return connStr;
    } catch (e) {
      console.log(`Connection failed: ${e.message.substring(0, 100)}`);
    }
  }
  return null;
}

(async () => {
  if (!SERVICE_KEY) {
    console.error("No SERVICE_KEY provided");
    process.exit(1);
  }

  console.log("=== Trying REST API ===");
  const restOk = await tryRestApi();
  if (restOk) {
    console.log("REST API method works!");
    return;
  }

  console.log("\n=== Trying direct PG connection ===");
  const connStr = await tryDirectPg();
  if (connStr) {
    console.log("Direct PG connection works!");
  } else {
    console.log("\nNeither method worked. Need database password or Supabase access token.");
  }
})();
