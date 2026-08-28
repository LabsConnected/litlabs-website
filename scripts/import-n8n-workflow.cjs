// Import the voice call orchestration workflow into n8n's SQLite database
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.N8N_DB_PATH || `${process.env.USERPROFILE || process.env.HOME}/.n8n/database.sqlite`;
const WORKFLOW_PATH = path.join(__dirname, "..", "n8n", "workflows", "04-voice-call-orchestration.json");

const db = new Database(DB_PATH);

// Read the workflow JSON
const workflowJson = fs.readFileSync(WORKFLOW_PATH, "utf8");
const workflow = JSON.parse(workflowJson);

// Generate a UUID for the workflow
const uuid = crypto.randomUUID();

// Check if workflow already exists
const existing = db.prepare("SELECT id, name, active FROM workflow_entity WHERE name = ?").get(workflow.name);
if (existing) {
  console.log(`Workflow already exists: id=${existing.id}, active=${existing.active}`);
  // Update it
  db.prepare(`
    UPDATE workflow_entity
    SET nodes = ?, connections = ?, settings = ?, updatedAt = datetime('now')
    WHERE id = ?
  `).run(
    JSON.stringify(workflow.nodes),
    JSON.stringify(workflow.connections || {}),
    JSON.stringify(workflow.settings || {}),
    existing.id
  );
  console.log(`Updated workflow ${existing.id}`);
} else {
  // Insert new workflow with UUID
  db.prepare(`
    INSERT INTO workflow_entity (id, name, nodes, connections, settings, active, versionId, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 0, ?, datetime('now'), datetime('now'))
  `).run(
    uuid,
    workflow.name,
    JSON.stringify(workflow.nodes),
    JSON.stringify(workflow.connections || {}),
    JSON.stringify(workflow.settings || {}),
    crypto.randomUUID()
  );
  console.log(`Inserted workflow with id ${uuid}`);
}

// Also insert webhook entity so n8n knows about the webhook path
const webhookPath = "voice-call-ended";
const webhookSchema = db.prepare("PRAGMA table_info(webhook_entity)").all();
console.log("Webhook schema:", webhookSchema.map(s => s.name).join(", "));

const existingWebhook = db.prepare("SELECT workflowId FROM webhook_entity WHERE workflowId = ? AND webhookPath = ?").get(
  existing?.id || uuid,
  webhookPath
);
if (!existingWebhook) {
  db.prepare(`
    INSERT INTO webhook_entity (workflowId, webhookPath, method, node, webhookId, pathLength)
    VALUES (?, ?, 'POST', 'Voice Call Webhook', ?, ?)
  `).run(
    existing?.id || uuid,
    webhookPath,
    webhookPath,
    webhookPath.length
  );
  console.log(`Inserted webhook entity for path: ${webhookPath}`);
} else {
  console.log(`Webhook entity already exists for path: ${webhookPath}`);
}

// Verify
const count = db.prepare("SELECT COUNT(*) as cnt FROM workflow_entity").get();
console.log(`Total workflows: ${count.cnt}`);

const webhooks = db.prepare("SELECT webhookPath, method FROM webhook_entity").all();
console.log(`Webhooks: ${JSON.stringify(webhooks)}`);

db.close();
console.log("Done — restart n8n to load the workflow");
