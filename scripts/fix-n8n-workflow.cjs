// Fix the workflow: create a history entry, set activeVersionId, restart n8n
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.N8N_DB_PATH || `${process.env.USERPROFILE || process.env.HOME}/.n8n/database.sqlite`;
const WORKFLOW_ID = "b128efab-f662-45d0-982d-58a93e8f04b3";
const WORKFLOW_PATH = path.join(__dirname, "..", "n8n", "workflows", "04-voice-call-orchestration.json");

const db = new Database(DB_PATH);

// Read the workflow
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

// Get current workflow state
const wf = db.prepare("SELECT * FROM workflow_entity WHERE id = ?").get(WORKFLOW_ID);
console.log("Current workflow:", { id: wf.id, name: wf.name, active: wf.active, versionId: wf.versionId, activeVersionId: wf.activeVersionId });

// Create a workflow history entry
const versionId = wf.versionId || crypto.randomUUID();
console.log("Using versionId:", versionId);

db.prepare(`
  INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
  VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, 0, '')
`).run(
  versionId,
  WORKFLOW_ID,
  JSON.stringify({}),
  JSON.stringify(workflow.nodes),
  JSON.stringify(workflow.connections || {}),
  workflow.name
);
console.log("Created workflow history entry");

// Now set activeVersionId
db.prepare("UPDATE workflow_entity SET activeVersionId = ?, active = 1 WHERE id = ?").run(versionId, WORKFLOW_ID);
console.log("Set activeVersionId and active=1");

// Verify
const updated = db.prepare("SELECT id, name, active, versionId, activeVersionId FROM workflow_entity WHERE id = ?").get(WORKFLOW_ID);
console.log("Updated:", JSON.stringify(updated, null, 2));

db.close();
console.log("\nDone — restart n8n to pick up the changes");
