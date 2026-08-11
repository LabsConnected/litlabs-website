// Import workflow with proper project/shared workflow ownership
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");

const DB_PATH = "/home/litbit/.n8n/database.sqlite";
const WORKFLOW_PATH = "/mnt/c/Users/litbi/CascadeProjects/litlabs-website/n8n/workflows/04-voice-call-orchestration.json";

const db = new Database(DB_PATH);

// Get the user and project
const user = db.prepare("SELECT id FROM user LIMIT 1").get();
console.log("User:", user);

// Check project table
const projects = db.prepare("SELECT id, name FROM project").all();
console.log("Projects:", JSON.stringify(projects, null, 2));

// Check shared_workflow schema
const swSchema = db.prepare("PRAGMA table_info(shared_workflow)").all();
console.log("shared_workflow schema:", swSchema.map(s => s.name).join(", "));

// Get existing shared workflows for reference
const existingSw = db.prepare("SELECT * FROM shared_workflow LIMIT 5").all();
console.log("Existing shared_workflows:", JSON.stringify(existingSw, null, 2));

// Delete the old broken workflow if it exists
const oldWf = db.prepare("SELECT id FROM workflow_entity WHERE name LIKE '%Voice Call%'").get();
if (oldWf) {
  console.log("Deleting old workflow:", oldWf.id);
  // Clear activeVersionId FK first, then delete in order
  db.prepare("UPDATE workflow_entity SET activeVersionId = NULL WHERE id = ?").run(oldWf.id);
  db.prepare("DELETE FROM webhook_entity WHERE workflowId = ?").run(oldWf.id);
  db.prepare("DELETE FROM shared_workflow WHERE workflowId = ?").run(oldWf.id);
  db.prepare("DELETE FROM workflow_entity WHERE id = ?").run(oldWf.id);
  db.prepare("DELETE FROM workflow_history WHERE workflowId = ?").run(oldWf.id);
}

// Read the workflow
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, "utf8"));

// Generate IDs
const workflowId = crypto.randomUUID();
const versionId = crypto.randomUUID();
const projectId = projects[0]?.id || crypto.randomUUID();
const userId = user?.id;

console.log("Using workflowId:", workflowId);
console.log("Using projectId:", projectId);
console.log("Using userId:", userId);

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
console.log("Inserted workflow");

// Create workflow history entry
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
console.log("Created history entry");

// Set activeVersionId
db.prepare("UPDATE workflow_entity SET activeVersionId = ? WHERE id = ?").run(versionId, workflowId);
console.log("Set activeVersionId");

// Create shared_workflow entry (links workflow to user + project with owner role)
// Check what role values are used
const roleCol = swSchema.find(s => s.name === "role");
console.log("Role column:", roleCol);

// shared_workflow schema: workflowId, projectId, role, createdAt, updatedAt
db.prepare(`
  INSERT INTO shared_workflow (workflowId, projectId, role, createdAt, updatedAt)
  VALUES (?, ?, 'workflow:owner', datetime('now'), datetime('now'))
`).run(workflowId, projectId);
console.log("Created shared_workflow entry");

// Insert webhook entity
db.prepare(`
  INSERT INTO webhook_entity (workflowId, webhookPath, method, node, webhookId, pathLength)
  VALUES (?, 'voice-call-ended', 'POST', 'Voice Call Webhook', 'voice-call-ended', 16)
`).run(workflowId);
console.log("Inserted webhook entity");

// Verify
const wfs = db.prepare("SELECT id, name, active, versionId, activeVersionId FROM workflow_entity").all();
console.log("\nAll workflows:", JSON.stringify(wfs, null, 2));

const sws = db.prepare("SELECT * FROM shared_workflow WHERE workflowId = ?").get(workflowId);
console.log("Shared workflow:", JSON.stringify(sws, null, 2));

db.close();
console.log("\nDone — restart n8n");
