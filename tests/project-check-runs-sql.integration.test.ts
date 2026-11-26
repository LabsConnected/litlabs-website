// @vitest-environment node
/**
 * ACC-09 — the project_check_runs schema contract, proven against a
 * real Postgres. This is the regression test for the defect unit
 * tests could not see: ACC-07 created user_id as uuid while every
 * identity in this app is a Clerk user ID string (studio_projects
 * .user_id is text), so every save through saveProjectCheckRun
 * failed with 22P02 and every read-back failed the same way —
 * completed checks never persisted and both panels fell back to
 * "Not run" (Acceptance Run 1 on aedb2b05). The unit suite mocks
 * the Supabase client, and a mock cannot enforce column types;
 * this suite applies the real migrations to real databases.
 *
 * Requires a throwaway Postgres the runner may create databases
 * on (superuser). Set ACC09_TEST_DATABASE_URL to a connection
 * string for its `postgres` database; without it the suite skips —
 * it never blocks the default run. Roles/auth are stubbed the way
 * Supabase shapes them: service_role has BYPASSRLS (what
 * supabaseAdmin authenticates as) and auth.uid() reads the JWT sub.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.ACC09_TEST_DATABASE_URL;
const describeSql = BASE_URL ? describe : describe.skip;

const CLERK_USER_ID = "user_3ACC09ClerkIdString";
const PROJECT_ID = "78ca9e96-1111-4111-8111-111111111111";
const UUID_USER_ID = "33333333-3333-4333-8333-333333333333";
const STRANGER_ID = "55555555-5555-4555-8555-555555555555";

const MIGRATIONS = {
  acc07: "supabase/migrations/20261125140000_create_project_check_runs.sql",
  typefix: "supabase/migrations/20261126120000_project_check_runs_user_id_text.sql",
  ownerinsert: "supabase/migrations/20261126130000_project_check_runs_owner_insert.sql",
} as const;

function dbUrl(base: string, dbName: string): string {
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function migrationSql(file: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), file), "utf8");
}

/** Supabase-shaped scaffolding: auth.uid(), the two roles, and the
 *  table grants Supabase's default privileges would have provided. */
async function scaffold(client: Client): Promise<void> {
  await client.query(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    do $$ begin
      if not exists (select from pg_roles where rolname = 'acc09_service_role') then
        create role acc09_service_role bypassrls nologin;
      end if;
      if not exists (select from pg_roles where rolname = 'acc09_authenticated') then
        create role acc09_authenticated nologin;
      end if;
    end $$;
    grant usage on schema public to acc09_service_role, acc09_authenticated;
  `);
}

async function grantTable(client: Client): Promise<void> {
  await client.query(`
    grant all on public.project_check_runs to acc09_service_role;
    grant select, insert, update, delete on public.project_check_runs to acc09_authenticated;
  `);
}

async function insertAsServiceRole(client: Client, userId: string): Promise<void> {
  await client.query("set role acc09_service_role");
  try {
    await client.query(
      `insert into public.project_check_runs (project_id, user_id, conversation_id, results, summary)
       values ($1, $2, 'conv-acc09', '[]'::jsonb, '{"total":7,"passed":5}'::jsonb)`,
      [PROJECT_ID, userId],
    );
  } finally {
    await client.query("reset role");
  }
}

describeSql("project_check_runs schema contract (ACC-09)", () => {
  const suffix = `${process.pid}`;
  const beforeDb = `acc09_before_${suffix}`;
  const afterDb = `acc09_after_${suffix}`;
  let admin: Client;
  let before: Client;
  let after: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: dbUrl(BASE_URL as string, "postgres") });
    await admin.connect();
    await admin.query(`create database ${beforeDb}`);
    await admin.query(`create database ${afterDb}`);

    before = new Client({ connectionString: dbUrl(BASE_URL as string, beforeDb) });
    await before.connect();
    await scaffold(before);
    await before.query(await migrationSql(MIGRATIONS.acc07));
    await grantTable(before);

    after = new Client({ connectionString: dbUrl(BASE_URL as string, afterDb) });
    await after.connect();
    await scaffold(after);
    await after.query(await migrationSql(MIGRATIONS.acc07));
    await after.query(await migrationSql(MIGRATIONS.typefix));
    await after.query(await migrationSql(MIGRATIONS.ownerinsert));
    await grantTable(after);
  }, 60_000);

  afterAll(async () => {
    await before?.end().catch(() => undefined);
    await after?.end().catch(() => undefined);
    if (admin) {
      await admin.query(`drop database if exists ${beforeDb}`).catch(() => undefined);
      await admin.query(`drop database if exists ${afterDb}`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  });

  it("BEFORE the fix: the app's save (service role, Clerk ID) is rejected with 22P02", async () => {
    await expect(insertAsServiceRole(before, CLERK_USER_ID)).rejects.toMatchObject({ code: "22P02" });
  });

  it("BEFORE the fix: the read-back filter fails the same way", async () => {
    await before.query("set role acc09_service_role");
    try {
      await expect(
        before.query(
          `select id from public.project_check_runs where project_id = $1 and user_id = $2`,
          [PROJECT_ID, CLERK_USER_ID],
        ),
      ).rejects.toMatchObject({ code: "22P02" });
    } finally {
      await before.query("reset role");
    }
  });

  it("BEFORE the fix: a genuine UUID identity saves fine — the identity format is the defect", async () => {
    await expect(insertAsServiceRole(before, UUID_USER_ID)).resolves.toBeUndefined();
  });

  it("AFTER the fix: the previously failing save succeeds and reads back (persistence round-trip)", async () => {
    await expect(insertAsServiceRole(after, CLERK_USER_ID)).resolves.toBeUndefined();
    await after.query("set role acc09_service_role");
    try {
      const { rows } = await after.query(
        `select user_id, conversation_id, summary from public.project_check_runs
          where project_id = $1 and user_id = $2 order by created_at desc limit 1`,
        [PROJECT_ID, CLERK_USER_ID],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].user_id).toBe(CLERK_USER_ID);
      expect(rows[0].conversation_id).toBe("conv-acc09");
      expect(rows[0].summary).toMatchObject({ total: 7, passed: 5 });
    } finally {
      await after.query("reset role");
    }
  });

  it("AFTER the fix: a user-scoped owner can insert and read; a stranger sees nothing", async () => {
    await after.query("set role acc09_authenticated");
    try {
      await after.query("set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444'");
      await expect(
        after.query(
          `insert into public.project_check_runs (project_id, user_id, results, summary)
           values ($1, '44444444-4444-4444-8444-444444444444', '[]'::jsonb, '{}'::jsonb)`,
          [PROJECT_ID],
        ),
      ).resolves.toBeDefined();
      const own = await after.query(`select count(*)::int as n from public.project_check_runs`);
      expect(own.rows[0].n).toBe(1);

      await after.query(`set request.jwt.claim.sub = '${STRANGER_ID}'`);
      const stranger = await after.query(`select count(*)::int as n from public.project_check_runs`);
      expect(stranger.rows[0].n).toBe(0);
      await expect(
        after.query(
          `insert into public.project_check_runs (project_id, user_id, results, summary)
           values ($1, '44444444-4444-4444-8444-444444444444', '[]'::jsonb, '{}'::jsonb)`,
          [PROJECT_ID],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await after.query("reset role");
    }
  });
});
