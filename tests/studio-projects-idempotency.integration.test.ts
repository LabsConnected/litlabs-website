// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { Client } from "pg";

/**
 * Studio project create-idempotency — real PostgreSQL invariants.
 *
 * The slug/time-window dedupe was replaced by a submission key enforced
 * by the `studio_projects_idempotency_key_uq` index. These tests run
 * the repository's exact sequence — pre-check, insert, 23505 → re-select —
 * against a real database so the concurrency guarantee is proven by
 * Postgres, not inferred from a mocked happy path.
 *
 * No skip conditions: if docker or postgres is unavailable the suite
 * fails loudly — the guarantee is a shipping requirement, not a
 * nice-to-have.
 */

const execFileAsync = promisify(execFile);
const CONTAINER_NAME = `litt-idempotency-${process.pid}`;
const PG_PORT = 47000 + (process.pid % 10000);
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;

let client: Client;
let clientB: Client;

const MIGRATIONS = [
  "20260720000000_studio_projects_github.sql",
  "20260721160000_studio_projects_workspace_runtime.sql",
  "20260726230000_canonical_project_source.sql",
  "20261003200000_global_litt_system_project.sql",
];
const IDEMPOTENCY_MIGRATION = "20261018000000_studio_projects_idempotency_key.sql";

async function docker(args: string[]) {
  return execFileAsync("docker", args, { timeout: 120_000 });
}

async function waitForPostgres() {
  for (let i = 0; i < 45; i++) {
    try {
      const { stdout } = await docker(["exec", CONTAINER_NAME, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
      if (stdout.includes("accepting connections")) return;
    } catch {
      // Container may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Postgres test container did not become ready");
}

async function applySql(relativePath: string) {
  const sql = await fs.readFile(path.join(process.cwd(), relativePath), "utf8");
  await client.query(sql);
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Mirrors createBlankProject's keyed path exactly:
 *   1. pre-check (user_id, idempotency_key) — hit returns that row's id
 *   2. insert — carries the key column only when the key is set
 *   3. 23505 → post-conflict re-select of the winner's committed row
 */
async function createWithKey(
  conn: Client,
  userId: string,
  name: string,
  key: string | null,
): Promise<string> {
  if (key) {
    const pre = await conn.query(
      `SELECT id FROM public.studio_projects WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, key],
    );
    if (pre.rows[0]) return pre.rows[0].id as string;
  }
  try {
    const res = key
      ? await conn.query(
          `INSERT INTO public.studio_projects
             (user_id, name, slug, source_type, access_mode, is_system, idempotency_key, workspace_status, runtime_status)
           VALUES ($1, $2, $3, 'blank', 'private', false, $4, 'not_prepared', 'stopped')
           RETURNING id`,
          [userId, name, slugify(name), key],
        )
      : await conn.query(
          `INSERT INTO public.studio_projects
             (user_id, name, slug, source_type, access_mode, is_system, workspace_status, runtime_status)
           VALUES ($1, $2, $3, 'blank', 'private', false, 'not_prepared', 'stopped')
           RETURNING id`,
          [userId, name, slugify(name)],
        );
    return res.rows[0].id as string;
  } catch (err) {
    if (key && (err as { code?: string }).code === "23505") {
      const post = await conn.query(
        `SELECT id FROM public.studio_projects WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, key],
      );
      if (post.rows[0]) return post.rows[0].id as string;
    }
    throw err;
  }
}

async function rowCount(where: string, params: unknown[] = []) {
  const res = await client.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM public.studio_projects WHERE ${where}`,
    params,
  );
  return res.rows[0].c;
}

describe("studio_projects create idempotency — real PostgreSQL", () => {
  beforeAll(async () => {
    await docker(["rm", "-f", CONTAINER_NAME]).catch(() => undefined);
    await docker([
      "run", "-d", "--name", CONTAINER_NAME,
      "-e", "POSTGRES_PASSWORD=postgres",
      "-e", "POSTGRES_DB=postgres",
      "-p", `${PG_PORT}:5432`,
      "postgres:17",
    ]);
    await waitForPostgres();

    client = new Client({ connectionString: DATABASE_URL });
    clientB = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await clientB.connect();
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS text
      LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
      LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    for (const migration of MIGRATIONS) {
      await applySql(path.join("supabase", "migrations", migration));
    }
  }, 180_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await clientB?.end().catch(() => undefined);
    await docker(["rm", "-f", CONTAINER_NAME]).catch(() => undefined);
  });

  it("unkeyed creates work against the pre-migration schema (no column referenced)", async () => {
    // Migration-first ordering: an unkeyed programmatic create must keep
    // working before 20261018000000 lands — the insert omits the column.
    const id = await createWithKey(client, "user-A", "Pre Migration", null);
    expect(id).toBeTruthy();
    const cols = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'studio_projects' AND column_name = 'idempotency_key'`,
    );
    expect(cols.rows[0].n).toBe(0);
  });

  it("the idempotency migration applies and is repeatable", async () => {
    await applySql(path.join("supabase", "migrations", IDEMPOTENCY_MIGRATION));
    // Re-running must be a no-op — ALTER ... IF NOT EXISTS +
    // CREATE UNIQUE INDEX IF NOT EXISTS.
    await applySql(path.join("supabase", "migrations", IDEMPOTENCY_MIGRATION));
    const cols = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'studio_projects' AND column_name = 'idempotency_key'`,
    );
    expect(cols.rows[0].n).toBe(1);
  });

  it("two concurrent same-key creates collapse to exactly one project", async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([
      createWithKey(client, "user-A", "Race Name", key),
      createWithKey(clientB, "user-A", "Race Name", key),
    ]);
    expect(a).toBe(b);
    expect(await rowCount("user_id = $1 AND idempotency_key = $2", ["user-A", key])).toBe(1);
  });

  it("two concurrent different-key creates with identical names mint two projects", async () => {
    const [a, b] = await Promise.all([
      createWithKey(client, "user-A", "Identical", randomUUID()),
      createWithKey(clientB, "user-A", "Identical", randomUUID()),
    ]);
    expect(a).not.toBe(b);
    expect(await rowCount("user_id = $1 AND name = $2", ["user-A", "Identical"])).toBe(2);
  });

  it("the same key under a different user is isolated — user-scoped uniqueness", async () => {
    const key = randomUUID();
    const a = await createWithKey(client, "user-A", "Mine", key);
    const b = await createWithKey(client, "user-B", "Mine", key);
    expect(a).not.toBe(b);
    expect(await rowCount("idempotency_key = $1", [key])).toBe(2);
  });

  it("a sequential same-key retry after commit returns the committed project", async () => {
    const key = randomUUID();
    const first = await createWithKey(client, "user-A", "Retry", key);
    const retried = await createWithKey(client, "user-A", "Retry", key);
    expect(retried).toBe(first);
    expect(await rowCount("user_id = $1 AND idempotency_key = $2", ["user-A", key])).toBe(1);
  });

  it("a hard delete frees the key for a genuinely new submission", async () => {
    const key = randomUUID();
    const first = await createWithKey(client, "user-A", "Doomed", key);
    await client.query(`DELETE FROM public.studio_projects WHERE id = $1`, [first]);
    const second = await createWithKey(client, "user-A", "Phoenix", key);
    expect(second).not.toBe(first);
  });

  it("NULL keys never conflict — unkeyed concurrent creates always mint rows", async () => {
    const [a, b] = await Promise.all([
      createWithKey(client, "user-A", "Null Key", null),
      createWithKey(clientB, "user-A", "Null Key", null),
    ]);
    expect(a).not.toBe(b);
    expect(await rowCount("user_id = $1 AND name = $2", ["user-A", "Null Key"])).toBe(2);
  });
});
