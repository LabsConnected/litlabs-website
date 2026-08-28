// Import the workflow directly into the Linux n8n database
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");

const DB_PATH = "/home/litbit/.n8n/database.sqlite";
const WORKFLOW_PATH = "/mnt/e/LiTT/Worktrees/final-integration/n8n/workflows/04-voice-call-orchestration.json";

const db = new Database(DB_PATH);

// Check schema
const schema = db.prepare("PRAGMA table_info(workflow_entity)").all();
console.log("Schema:", schema.map(s => s.name).join(", "));

// Read the workflow
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

// Generate IDs
const workflowId = crypto.randomUUID();
const versionId = crypto.randomUUID();

// Insert the workflow (without activeVersionId first)
db.prepare(`
  INSERT INTO workflow_entity (id, name, nodes, connections, settings, active, versionId, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
`).run(
  workflowId,
  workflow.name,
  JSON.stringify(workflow.nodes),
  JSON.stringify(workflow.connections || {}),
  JSON.stringify(workflow.settings || {}),
  versionId
);
console.log("Inserted workflow:", workflowId);

// Create workflow history entry (must exist before setting activeVersionId)
db.prepare(`
  INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
  VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, 0, '')
`).run(
  versionId,
  workflowId,
  "{}",
  JSON.stringify(workflow.nodes),
  JSON.stringify(workflow.connections || {}),
  workflow.name
);
console.log("Created history entry:", versionId);

// Now set activeVersionId
db.prepare("UPDATE workflow_entity SET activeVersionId = ? WHERE id = ?").run(versionId, workflowId);
console.log("Set activeVersionId");

// Insert webhook entity
db.prepare(`
  INSERT INTO webhook_entity (workflowId, webhookPath, method, node, webhookId, pathLength)
  VALUES (?, 'voice-call-ended', 'POST', 'Voice Call Webhook', 'voice-call-ended', 16)
`).run(workflowId);
console.log("Inserted webhook entity");

// Verify
const wfs = db.prepare("SELECT id, name, active, versionId, activeVersionId FROM workflow_entity").all();
console.log("\nAll workflows:", JSON.stringify(wfs, null, 2));

const webhooks = db.prepare("SELECT * FROM webhook_entity").all();
console.log("Webhooks:", JSON.stringify(webhooks, null, 2));

db.close();
console.log("\nDone — restart n8n to activate");
