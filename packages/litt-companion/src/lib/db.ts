import * as SQLite from "expo-sqlite";

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync("litt_companion.db");
    await initTables(dbInstance);
  }
  return dbInstance;
}

async function initTables(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_queue (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      conversation_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects_cache (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

export async function saveLocalMessage(msg: {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: string;
  status: string;
}) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO messages (id, conversation_id, role, content, timestamp, status) VALUES (?, ?, ?, ?, ?, ?);`,
    [msg.id, msg.conversation_id, msg.role, msg.content, msg.timestamp, msg.status]
  );
}

export async function enqueuePendingCommand(cmd: {
  id: string;
  project_id?: string;
  conversation_id: string;
  payload: string;
  created_at: string;
}) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO pending_queue (id, project_id, conversation_id, payload, created_at, status) VALUES (?, ?, ?, ?, ?, ?);`,
    [cmd.id, cmd.project_id || null, cmd.conversation_id, cmd.payload, cmd.created_at, "pending"]
  );
}

export async function getPendingCommands() {
  const db = await getDatabase();
  return await db.getAllAsync<{
    id: string;
    project_id: string | null;
    conversation_id: string;
    payload: string;
    created_at: string;
    status: string;
  }>(`SELECT * FROM pending_queue WHERE status = 'pending' ORDER BY created_at ASC;`);
}
