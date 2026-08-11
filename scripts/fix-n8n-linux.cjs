const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");
const db = new Database("/home/litbit/.n8n/database.sqlite");
const wfs = db.prepare("SELECT id, name, active, versionId, activeVersionId FROM workflow_entity").all();
console.log(JSON.stringify(wfs, null, 2));
const vwf = wfs.find(w => w.name.includes("Voice Call"));
if (vwf && !vwf.activeVersionId) {
  const vid = vwf.versionId || crypto.randomUUID();
  const wf = JSON.parse(fs.readFileSync("/mnt/c/Users/litbi/CascadeProjects/litlabs-website/n8n/workflows/04-voice-call-orchestration.json", "utf8"));
  const ex = db.prepare("SELECT versionId FROM workflow_history WHERE versionId = ?").get(vid);
  if (!ex) {
    db.prepare("INSERT INTO workflow_history (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description) VALUES (?,?,?,datetime('now'),datetime('now'),?,?,?,0,'')").run(vid, vwf.id, "{}", JSON.stringify(wf.nodes), JSON.stringify(wf.connections || {}), wf.name);
  }
  db.prepare("UPDATE workflow_entity SET activeVersionId = ?, active = 1 WHERE id = ?").run(vid, vwf.id);
  console.log("Fixed:", JSON.stringify(db.prepare("SELECT id, name, active, versionId, activeVersionId FROM workflow_entity WHERE id = ?").get(vwf.id), null, 2));
} else if (vwf && vwf.activeVersionId) {
  console.log("activeVersionId already set:", vwf.activeVersionId);
} else {
  console.log("Voice Call workflow not found");
}
db.close();
