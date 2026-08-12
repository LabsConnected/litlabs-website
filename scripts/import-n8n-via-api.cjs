// Import and activate the voice call workflow via n8n REST API
const fs = require("fs");
const path = require("path");

const N8N_BASE = "https://n8n.litlabs.net";
const API_KEY = "n8n_api_c46b589dba487fa7462a05eda1e9986b95d7a77890c6d43a";
const CF_CLIENT_ID = "5316aebf2779a332dc9079507b853905.access";
const CF_CLIENT_SECRET = "810cf2820b308fea9b72c148ad91878bbeda480223108a6a110807c3f1ebf2ab";

const headers = {
  "X-N8N-API-KEY": API_KEY,
  "Content-Type": "application/json",
  "CF-Access-Client-Id": CF_CLIENT_ID,
  "CF-Access-Client-Secret": CF_CLIENT_SECRET,
};

async function main() {
  // 1. List existing workflows
  console.log("1. Listing existing workflows...");
  const listRes = await fetch(`${N8N_BASE}/api/v1/workflows`, { headers });
  const list = await listRes.json();
  console.log("   Status:", listRes.status);
  if (list.data) {
    console.log("   Workflows:", list.data.map(w => ({ id: w.id, name: w.name, active: w.active })));
  } else {
    console.log("   Response:", JSON.stringify(list).slice(0, 300));
  }

  // 2. Read the workflow file
  const workflowPath = path.join(__dirname, "..", "n8n", "workflows", "04-voice-call-orchestration.json");
  const workflowJson = fs.readFileSync(workflowPath, "utf8");
  const workflow = JSON.parse(workflowJson);

  // 3. Check if it already exists
  const existing = list.data?.find(w => w.name === workflow.name);

  let workflowId;
  if (existing) {
    // Update existing
    console.log(`\n2. Updating existing workflow ${existing.id}...`);
    const updateRes = await fetch(`${N8N_BASE}/api/v1/workflows/${existing.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings,
      }),
    });
    const updated = await updateRes.json();
    console.log("   Status:", updateRes.status);
    workflowId = updated.data?.id || existing.id;
  } else {
    // Create new
    console.log("\n2. Creating new workflow...");
    const createRes = await fetch(`${N8N_BASE}/api/v1/workflows`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings,
      }),
    });
    const created = await createRes.json();
    console.log("   Status:", createRes.status);
    console.log("   Response:", JSON.stringify(created).slice(0, 300));
    workflowId = created.data?.id;
  }

  if (!workflowId) {
    console.error("Failed to get workflow ID");
    process.exit(1);
  }

  // 4. Activate the workflow
  console.log(`\n3. Activating workflow ${workflowId}...`);
  const activateRes = await fetch(`${N8N_BASE}/api/v1/workflows/${workflowId}/activate`, {
    method: "POST",
    headers,
  });
  const activated = await activateRes.json();
  console.log("   Status:", activateRes.status);
  console.log("   Active:", activated.data?.active);

  // 5. Verify
  console.log("\n4. Verifying webhook...");
  const testBody = {
    event: "voice.call.ended",
    source: "litt-vapi",
    timestamp: new Date().toISOString(),
    data: {
      callId: "test-api-verify",
      from: "+12314285411",
      to: "+13239165462",
      callerName: null,
      startedAt: "2026-08-11T20:30:00Z",
      endedAt: "2026-08-11T20:30:30Z",
      durationMs: 30000,
      status: "ended",
      intent: "intent:website",
      leadStatus: "hot",
      followUpNeeded: true,
      summary: "API verification test",
      isKnownUser: false,
      userId: null,
      projectId: null,
      projectName: null,
      transcript: "AI: Welcome\nUser: Hi",
      conversationId: null,
    },
  };
  const webhookRes = await fetch(`${N8N_BASE}/webhook/voice-call-ended`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Access-Client-Id": CF_CLIENT_ID,
      "CF-Access-Client-Secret": CF_CLIENT_SECRET,
    },
    body: JSON.stringify(testBody),
  });
  const webhookText = await webhookRes.text();
  console.log("   Webhook status:", webhookRes.status);
  console.log("   Webhook response:", webhookText.slice(0, 200));
}

main().catch(console.error);
