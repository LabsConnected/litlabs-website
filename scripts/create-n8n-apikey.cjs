// Create an n8n API key directly in the database
const Database = require("better-sqlite3");
const crypto = require("crypto");

const DB_PATH = process.env.N8N_DB_PATH || `${process.env.USERPROFILE || process.env.HOME}/.n8n/database.sqlite`;
const db = new Database(DB_PATH);

// Check user_api_keys schema
const schema = db.prepare("PRAGMA table_info(user_api_keys)").all();
console.log("user_api_keys schema:", schema.map(s => s.name).join(", "));

// Check if there are existing users
const users = db.prepare("SELECT id, email, firstName, lastName FROM user").all();
console.log("Users:", JSON.stringify(users, null, 2));

// Check existing API keys
const existingKeys = db.prepare("SELECT * FROM user_api_keys").all();
console.log("Existing API keys:", existingKeys.length);

// Generate a new API key
const apiKey = "n8n_api_" + crypto.randomBytes(24).toString("hex");
const keyId = crypto.randomUUID();
const userId = users[0]?.id;

if (!userId) {
  console.error("No user found — cannot create API key");
  process.exit(1);
}

// Insert the API key
try {
  db.prepare(`
    INSERT INTO user_api_keys (id, label, apiKey, userId, createdAt, updatedAt)
    VALUES (?, 'cli-automation', ?, ?, datetime('now'), datetime('now'))
  `).run(keyId, apiKey, userId);
  console.log("\n=== N8N API KEY CREATED ===");
  console.log(apiKey);
  console.log("==========================\n");
} catch (err) {
  console.error("Failed to create API key:", err.message);
  // Try alternate column names
  const cols = schema.map(s => s.name);
  console.log("Columns:", cols.join(", "));
}

db.close();
