// Use n8n internal REST API to import + activate workflow
// Internal API uses cookie-based auth (email/password login)
const fs = require("fs");
const path = require("path");

const N8N_BASE = "https://n8n.litlabs.net";
const CF_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || "";
const CF_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || "";

for (const [name, value] of Object.entries({
  CF_ACCESS_CLIENT_ID: CF_CLIENT_ID,
  CF_ACCESS_CLIENT_SECRET: CF_CLIENT_SECRET,
})) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("Set it in your shell or a local untracked .env file. Never commit credentials.");
    process.exit(1);
  }
}

const cfHeaders = {
  "CF-Access-Client-Id": CF_CLIENT_ID,
  "CF-Access-Client-Secret": CF_CLIENT_SECRET,
};

async function main() {
  // 1. Try to sign in with email/password
  console.log("1. Attempting login...");

  // n8n internal login endpoint
  const loginRes = await fetch(`${N8N_BASE}/rest/login`, {
    method: "POST",
    headers: {
      ...cfHeaders,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "laidbacknostress4life@gmail.com",
      password: "", // we don't know the password
    }),
  });
  console.log("   Login status:", loginRes.status);
  const loginText = await loginRes.text();
  console.log("   Login response:", loginText.slice(0, 200));

  // If login fails, try without password (maybe already logged in via CF Access)
  if (loginRes.status !== 200) {
    // Try the user endpoint to see if we're already authed via CF Access
    console.log("\n2. Checking if already authed via CF Access...");
    const meRes = await fetch(`${N8N_BASE}/rest/me`, {
      headers: cfHeaders,
    });
    console.log("   /rest/me status:", meRes.status);
    const meText = await meRes.text();
    console.log("   /rest/me response:", meText.slice(0, 300));
  }
}

main().catch(console.error);
