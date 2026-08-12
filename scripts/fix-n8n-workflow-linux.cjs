// Fix the workflow in the LINUX n8n database (the one n8n actually uses)
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// The Linux VM's n8n database, accessed via WSL network path
const DB_PATH = "\\\\wsl$\\Ubuntu\\home\\litbit\\.n8n\\database.sqlite";
const WORKFLOW_PATH = path.join(__dirname, "..", "n8n", "workflows", "04-voice-call-orchestration.json");

const db = new Database(DB_PATH);

// List all workflows
const workflows = db.prepare("SELECT id, name, active, versionId, activeVersionId FROM workflow_entity").all();
console.log("All workflows:", JSON.stringify(workflows, null, 2));

// Find our voice call workflow
const voiceWf = workflows.find(w => w.name.includes("Voice Call"));
if (!voiceWf) {
  console.error("Voice Call workflow not found in Linux DB!");
  console.log("Available workflows:", workflows.map(w => w.name));
  process.exit(1);
}

console.log("\nVoice Call workflow:", JSON.stringify(voiceWf, null, 2));

// Read the workflow JSON
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

// Create a workflow history entry if activeVersionId is null
if (!voiceWf.activeVersionId) {
  const versionId = voiceWf.versionId || crypto.randomUUID();
  console.log("\nCreating workflow history entry with versionId:", versionId);

  // Check if history entry already exists
  const existingHistory = db.prepare("SELECT versionId FROM workflow_history WHERE versionId = ?").get(versionId);
  if (!existingHistory) {
    db.prepare(`
      INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
      VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, 0, '')
    `).run(
      versionId,
      voiceWf.id,
      JSON.stringify({}),
      JSON.stringify(workflow.nodes),
      JSON.stringify(workflow.connections || {}),
      workflow.name
    );
    console.log("Created workflow history entry");
  } else {
    console.log("History entry already exists");
  }

  // Set activeVersionId
  db.prepare("UPDATE workflow_entity SET activeVersionId = ?, active = 1 WHERE id = ?").run(versionId, voiceWf.id);
  console.log("Set activeVersionId and active=1");
} else {
  console.log("activeVersionId already set:", voiceWf.activeVersionId);
}

// Verify
const updated = db.prepare("SELECT id, name, active, versionId, activeVersionId FROM workflow_entity WHERE id = ?").get(voiceWf.id);
console.log("\nUpdated:", JSON.stringify(updated, null, 2));

// Check webhooks
const webhooks = db.prepare("SELECT * FROM webhook_entity WHERE workflowId = ?").all(voiceWf.id);
console.log("Webhooks:", JSON.stringify(webhooks, null, 2));

db.close();
console.log("\nDone — restart n8n in the VM to pick up changes");
