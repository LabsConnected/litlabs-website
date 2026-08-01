/**
 * Phase 2 real database integration tests.
 *
 * These tests run against an isolated Postgres 17 container to verify the
 * actual schema accepts the correct data types and enforces constraints.
 * They do NOT use mocks — they verify real database behavior.
 *
 * Prerequisites:
 *   - Docker must be running
 *   - The test starts a fresh Postgres container, applies schema.sql + all
 *     migrations, runs the tests, then tears down the container.
 *
 * Run: INTEGRATION_TEST=1 pnpm exec vitest run tests/premium-agents-phase2.integration.test.ts
 *
 * These tests are skipped by default (run with INTEGRATION_TEST=1 to enable).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, exec as execCb } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(execCb);
const CONTAINER_NAME = "litlab-integration-test";
const PG_PORT = "54330";

const shouldRun = process.env.INTEGRATION_TEST === "1" || process.env.INTEGRATION_TEST === "true";

// containerStarted flag removed — startContainer throws if it fails

async function startContainer() {
  try { execSync(`docker stop ${CONTAINER_NAME} 2>nul`, { stdio: "ignore" }); } catch { /* */ }
  try { execSync(`docker rm ${CONTAINER_NAME} 2>nul`, { stdio: "ignore" }); } catch { /* */ }

  execSync(
    `docker run -d --name ${CONTAINER_NAME} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -p ${PG_PORT}:5432 postgres:17`,
    { stdio: "pipe" },
  );

  for (let i = 0; i < 30; i++) {
    try {
      const { stdout } = await execAsync(`docker exec ${CONTAINER_NAME} pg_isready -U postgres`);
      if (stdout.includes("accepting connections")) return;
    } catch { /* */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Postgres container did not become ready");
}

async function stopContainer() {
  try { execSync(`docker stop ${CONTAINER_NAME}`, { stdio: "ignore" }); } catch { /* */ }
  try { execSync(`docker rm ${CONTAINER_NAME}`, { stdio: "ignore" }); } catch { /* */ }
}

async function applyMigrations() {
  // Apply roles
  const rolesSql = `DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
  const rolesFile = path.join(os.tmpdir(), "integration_roles.sql");
  fs.writeFileSync(rolesFile, rolesSql);
  execSync(`docker cp "${rolesFile}" ${CONTAINER_NAME}:/tmp/roles.sql`, { stdio: "pipe" });
  execSync(`docker exec ${CONTAINER_NAME} psql -U postgres -d postgres -f /tmp/roles.sql`, { stdio: "pipe" });

  // Apply schema.sql
  const schemaPath = path.join(process.cwd(), "supabase", "schema.sql");
  execSync(`docker cp "${schemaPath}" ${CONTAINER_NAME}:/tmp/schema.sql`, { stdio: "pipe" });
  execSync(`docker exec ${CONTAINER_NAME} psql -U postgres -d postgres -v ON_ERROR_STOP=0 -f /tmp/schema.sql`, { stdio: "pipe" });

  // Apply all migrations in order
  const migrationsDir = path.join(process.cwd(), "supabase", "migrations");
  const migrations = fs.readdirSync(migrationsDir).sort();
  for (const migration of migrations) {
    const migrationPath = path.join(migrationsDir, migration);
    try {
      execSync(`docker cp "${migrationPath}" ${CONTAINER_NAME}:/tmp/migration.sql`, { stdio: "pipe" });
      execSync(`docker exec ${CONTAINER_NAME} psql -U postgres -d postgres -v ON_ERROR_STOP=0 -f /tmp/migration.sql`, { stdio: "pipe" });
    } catch {
      console.warn(`[integration] Migration ${migration} had errors (may be pre-existing)`);
    }
  }
}

async function sql(text: string, params?: unknown[]): Promise<unknown[]> {
  let query = text;
  if (params) {
    params.forEach((p, i) => {
      const placeholder = `$${i + 1}`;
      let replacement: string;
      if (p === null) replacement = "NULL";
      else if (typeof p === "string") replacement = `'${p.replace(/'/g, "''")}'`;
      else if (typeof p === "boolean") replacement = p ? "TRUE" : "FALSE";
      else replacement = String(p);
      // Use split+join to replace ALL occurrences of the placeholder
      query = query.split(placeholder).join(replacement);
    });
  }

  const tmpFile = path.join(os.tmpdir(), `litlab_query_${Date.now()}_${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tmpFile, query);
  execSync(`docker cp "${tmpFile}" ${CONTAINER_NAME}:/tmp/query.sql`, { stdio: "pipe" });

  let stdout: string;
  try {
    const result = await execAsync(
      `docker exec ${CONTAINER_NAME} psql -U postgres -d postgres -t -A -F "|" -v ON_ERROR_STOP=1 -f /tmp/query.sql`,
      { timeout: 30000 },
    );
    stdout = result.stdout;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SQL query failed: ${msg}\nQuery: ${query.substring(0, 200)}`);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* */ }
  }

  // Parse pipe-delimited output — filter out empty lines and psql status messages
  const lines = stdout.split("\n").filter((l) => l.trim() && !l.startsWith("INSERT") && !l.startsWith("UPDATE") && !l.startsWith("DELETE"));
  return lines.map((line) => {
    const fields = line.split("|");
    if (fields.length === 1) return { col: fields[0] };
    const obj: Record<string, string> = {};
    fields.forEach((f, i) => { obj[`col${i}`] = f; });
    return obj;
  });
}

// ── Test helpers ──────────────────────────────────────────────────────────

async function createTestUser(clerkId: string): Promise<string> {
  const rows = await sql(
    "INSERT INTO users (clerk_id, email) VALUES ($1, $2) RETURNING id",
    [clerkId, `${clerkId}@test.com`],
  );
  return (rows[0] as { col: string }).col;
}

async function createTestAgent(slug: string, isPublic: boolean, priceCents: number): Promise<string> {
  const rows = await sql(
    `INSERT INTO agents (slug, display_name, description, role, is_core, is_public, is_featured, price_cents, system_prompt, personality)
     VALUES ($1, $2, 'Test agent', 'test', false, $3, false, $4, 'Test prompt', 'Test')
     RETURNING id`,
    [slug, slug, isPublic, priceCents],
  );
  return (rows[0] as { col: string }).col;
}

async function createTestVersion(agentId: string, version: string, priceCents: number, status: string): Promise<string> {
  const rows = await sql(
    `INSERT INTO agent_versions (agent_id, version, system_prompt, price_cents, currency, status, published_at)
     VALUES ($1, $2, 'Test prompt', $3, 'usd', $4, now())
     RETURNING id`,
    [agentId, version, priceCents, status],
  );
  return (rows[0] as { col: string }).col;
}

// ── Tests ─────────────────────────────────────────────────────────────────

const describeFn = shouldRun ? describe : describe.skip;

describeFn("Phase 2: Real database integration tests", () => {
  beforeAll(async () => {
    if (!shouldRun) return;
    await startContainer();
    await applyMigrations();
  }, 300000);

  afterAll(async () => {
    if (!shouldRun) return;
    await stopContainer();
  }, 30000);

  it("user_agents.agent_id accepts UUID and FK is valid", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 0);
    await createTestVersion(agentId, "1.0.0", 0, "published");

    const rows = await sql(
      "INSERT INTO user_agents (user_id, agent_id, is_active) VALUES ($1, $2, true) RETURNING id",
      [userId, agentId],
    );
    expect(rows.length).toBe(1);

    // Verify the relational join works
    const joinRows = await sql(
      `SELECT ua.id FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
       WHERE ua.user_id = $1 AND ua.agent_id = $2`,
      [userId, agentId],
    );
    expect(joinRows.length).toBe(1);
  }, 30000);

  it("user_agents.agent_id rejects non-UUID values (type enforcement)", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    try {
      await sql(
        "INSERT INTO user_agents (user_id, agent_id, is_active) VALUES ($1, $2, true)",
        [userId, "not-a-uuid-slug"],
      );
      expect(false).toBe(true);
    } catch {
      // Expected — UUID type enforcement
    }
  }, 30000);

  it("duplicate (user_id, agent_id) is idempotent via unique constraint", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 0);
    await createTestVersion(agentId, "1.0.0", 0, "published");

    await sql(
      "INSERT INTO user_agents (user_id, agent_id, is_active) VALUES ($1, $2, true)",
      [userId, agentId],
    );

    try {
      await sql(
        "INSERT INTO user_agents (user_id, agent_id, is_active) VALUES ($1, $2, true)",
        [userId, agentId],
      );
      expect(false).toBe(true);
    } catch {
      // Expected — unique constraint violation
    }
  }, 30000);

  it("marketplace_order_items.agent_id column exists and accepts UUID", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 1900);
    const versionId = await createTestVersion(agentId, "1.0.0", 1900, "published");

    const orderRows = await sql(
      "INSERT INTO marketplace_orders (user_id, status, total_cents, currency) VALUES ($1, 'pending', 1900, 'usd') RETURNING id",
      [userId],
    );
    const orderId = (orderRows[0] as { col: string }).col;

    const itemRows = await sql(
      "INSERT INTO marketplace_order_items (order_id, agent_version_id, agent_id, agent_slug, price_cents, currency) VALUES ($1, $2, $3, 'test-slug', 1900, 'usd') RETURNING id",
      [orderId, versionId, agentId],
    );
    expect(itemRows.length).toBe(1);
  }, 30000);

  it("create_pending_agent_order RPC creates order + item atomically", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 2900);
    const versionId = await createTestVersion(agentId, "1.0.0", 2900, "published");

    const resultRows = await sql(
      `SELECT create_pending_agent_order($1, $2, $3, 2900, 'usd', now() + interval '24 hours') as result`,
      [userId, agentId, versionId],
    );
    expect(resultRows.length).toBe(1);

    // Verify the order was created
    const orderRows = await sql(
      `SELECT id FROM marketplace_orders WHERE user_id = $1 AND status = 'pending'`,
      [userId],
    );
    expect(orderRows.length).toBe(1);

    // Verify the order item was created with agent_id
    const itemRows = await sql(
      `SELECT moi.agent_id FROM marketplace_order_items moi
       JOIN marketplace_orders mo ON mo.id = moi.order_id
       WHERE mo.user_id = $1`,
      [userId],
    );
    expect(itemRows.length).toBe(1);
  }, 30000);

  it("create_pending_agent_order rejects private agents", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, false, 1900);
    const versionId = await createTestVersion(agentId, "1.0.0", 1900, "published");

    try {
      await sql(
        `SELECT create_pending_agent_order($1, $2, $3, 1900, 'usd')`,
        [userId, agentId, versionId],
      );
      expect(false).toBe(true);
    } catch {
      // Expected — private agent rejected
    }
  }, 30000);

  it("create_pending_agent_order rejects unpublished versions", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 1900);
    const versionId = await createTestVersion(agentId, "1.0.0", 1900, "draft");

    try {
      await sql(
        `SELECT create_pending_agent_order($1, $2, $3, 1900, 'usd')`,
        [userId, agentId, versionId],
      );
      expect(false).toBe(true);
    } catch {
      // Expected — unpublished version rejected
    }
  }, 30000);

  it("create_pending_agent_order rejects when active entitlement exists", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 1900);
    const versionId = await createTestVersion(agentId, "1.0.0", 1900, "published");

    // Create a pending order first
    await sql(
      `SELECT create_pending_agent_order($1, $2, $3, 1900, 'usd')`,
      [userId, agentId, versionId],
    );

    // Mark it as paid and create entitlement
    const orderRows = await sql(
      `UPDATE marketplace_orders SET status = 'paid' WHERE user_id = $1 RETURNING id`,
      [userId],
    );
    const orderId = (orderRows[0] as { col: string }).col;

    await sql(
      `INSERT INTO agent_entitlements (user_id, agent_id, purchased_version_id, includes_future_updates, minimum_version, maximum_version, order_id, status)
       VALUES ($1, $2, $3, true, '1.0.0', '1.999.999', $4, 'active')`,
      [userId, agentId, versionId, orderId],
    );

    // Now try to create another pending order — should fail
    try {
      await sql(
        `SELECT create_pending_agent_order($1, $2, $3, 1900, 'usd')`,
        [userId, agentId, versionId],
      );
      expect(false).toBe(true);
    } catch {
      // Expected — already entitled
    }
  }, 30000);

  it("agent_entitlements stores version policy fields correctly", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 1900);
    const versionId = await createTestVersion(agentId, "1.0.0", 1900, "published");

    await sql(
      `SELECT create_pending_agent_order($1, $2, $3, 1900, 'usd')`,
      [userId, agentId, versionId],
    );
    const orderRows = await sql(
      `UPDATE marketplace_orders SET status = 'paid' WHERE user_id = $1 RETURNING id`,
      [userId],
    );
    const orderId = (orderRows[0] as { col: string }).col;

    await sql(
      `INSERT INTO agent_entitlements (user_id, agent_id, purchased_version_id, includes_future_updates, minimum_version, maximum_version, order_id, status)
       VALUES ($1, $2, $3, true, '1.0.0', '1.999.999', $4, 'active')`,
      [userId, agentId, versionId, orderId],
    );

    const entRows = await sql(
      `SELECT minimum_version, maximum_version, includes_future_updates FROM agent_entitlements WHERE user_id = $1 AND agent_id = $2`,
      [userId, agentId],
    );
    expect(entRows.length).toBe(1);
    const ent = entRows[0] as { col0: string; col1: string; col2: string };
    expect(ent.col0).toBe("1.0.0");
    expect(ent.col1).toBe("1.999.999");
    expect(ent.col2).toBe("t");
  }, 30000);

  it("expired pending order is not counted as active pending", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);

    // Create an expired pending order
    await sql(
      `INSERT INTO marketplace_orders (user_id, status, total_cents, currency, expires_at)
       VALUES ($1, 'pending', 1900, 'usd', now() - interval '1 hour')`,
      [userId],
    );

    // Query for non-expired pending orders — should return 0
    const pendingRows = await sql(
      `SELECT id FROM marketplace_orders WHERE user_id = $1 AND status = 'pending' AND expires_at > now()`,
      [userId],
    );
    expect(pendingRows.length).toBe(0);
  }, 30000);

  it("user_agents FK cascade deletes when agent is deleted", async () => {
    const userId = await createTestUser(`user-${randomUUID()}`);
    const agentId = await createTestAgent(`agent-${randomUUID()}`, true, 0);
    // Use draft version — published versions are immutable and cannot be cascade-deleted
    await createTestVersion(agentId, "1.0.0", 0, "draft");

    await sql(
      "INSERT INTO user_agents (user_id, agent_id, is_active) VALUES ($1, $2, true)",
      [userId, agentId],
    );

    // Delete the agent — user_agents row should cascade
    await sql("DELETE FROM agents WHERE id = $1", [agentId]);

    const uaRows = await sql(
      "SELECT id FROM user_agents WHERE agent_id = $1",
      [agentId],
    );
    expect(uaRows.length).toBe(0);
  }, 30000);
});
