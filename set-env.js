const { execSync } = require('child_process');

const SUPABASE_URL = "https://rokbfvuoqildggnhappy.supabase.co";
const SUPABASE_ANON = "eyJhbG...jLRE";
const SUPABASE_SERVICE = "eyJhbG...I7T0";
const SUPABASE_JWT = "/i/wwXXYgvfUFhd2Zn5NCXhLMJ1sAYhAopkOyDiM06CCfaHVtw4GxWj38AjnJvvcOd2OEXEPrLbXRL9916/a6Q==";
const SITE_URL = "https://litlabs.net";

const vars = [
  ["NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", SUPABASE_ANON],
  ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE],
  ["SUPABASE_JWT_SECRET", SUPABASE_JWT],
  ["NEXT_PUBLIC_SITE_URL", SITE_URL],
];

for (const [name, value] of vars) {
  // Check if already exists
  try {
    const out = execSync(`vercel env ls production 2>&1`, { timeout: 15000 }).toString();
    if (out.includes(name)) {
      console.log(`SKIP ${name} - already exists`);
      continue;
    }
  } catch {}

  try {
    const result = execSync(`vercel env add ${name} production`, {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    }).toString();
    console.log(`OK ${name}: ${result.slice(0,80)}`);
  } catch(e) {
    console.log(`ERR ${name}: ${e.stdout?.toString().slice(0,100)} ${e.stderr?.toString().slice(0,100)}`);
  }
}

console.log("DONE");
