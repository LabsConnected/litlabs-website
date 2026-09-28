// @vitest-environment node
// Live privilege checks against a local Postgres server reached the same way
// this file runs SQL: `sudo -u postgres psql` on the default socket.
// describe.skipIf skips the suite when that server is not accepting
// connections (the GitHub "Build and Type Check" job has no local Postgres).
// The assertions below are unchanged when the server is reachable.
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, afterAll } from "vitest";

const SKIP_REASON =
  "skipped: no Postgres reachable on socket /var/run/postgresql/.s.PGSQL.5432";

function postgresReachable(): boolean {
  try {
    execFileSync(
      "sudo",
      ["-n", "-u", "postgres", "psql", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", "SELECT 1"],
      { stdio: "ignore", timeout: 10_000 },
    );
    return true;
  } catch {
    return false;
  }
}

const hasPostgres = postgresReachable();
if (!hasPostgres) {
  console.info(`[social-counter-rpc-privileges] ${SKIP_REASON}`);
}

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const DB = "social_rpc_priv_check";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const POST_ID = "22222222-2222-2222-2222-222222222222";
const POLL_ID = "33333333-3333-3333-3333-333333333333";
const OPTION_ID = "44444444-4444-4444-4444-444444444444";
const COMMENT_ID = "55555555-5555-5555-5555-555555555555";

const CALLS = [
  `SELECT public.increment_post_reposts('${POST_ID}')`,
  `SELECT public.decrement_post_reposts('${POST_ID}')`,
  `SELECT public.increment_post_saves('${POST_ID}')`,
  `SELECT public.decrement_post_saves('${POST_ID}')`,
  `SELECT public.increment_post_shares('${POST_ID}')`,
  `SELECT public.increment_poll_option_votes('${OPTION_ID}')`,
  `SELECT public.increment_comment_likes('${COMMENT_ID}')`,
  `SELECT public.decrement_comment_likes('${COMMENT_ID}')`,
];

async function psql(database: string, sql: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "sudo",
      ["-n", "-u", "postgres", "psql", "-d", database, "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
      { timeout: 30_000 },
    );
    return { ok: true, stdout: stdout.trim(), stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, stdout: (err.stdout ?? "").trim(), stderr: err.stderr ?? String(error) };
  }
}

async function psqlFile(database: string, file: string): Promise<void> {
  await execFileAsync(
    "sudo",
    ["-n", "-u", "postgres", "psql", "-d", database, "-v", "ON_ERROR_STOP=1", "-f", file],
    { timeout: 60_000 },
  );
}

describe.skipIf(!hasPostgres)(
  hasPostgres ? "social counter RPC execute privileges" : `social counter RPC execute privileges (${SKIP_REASON})`,
  () => {
  afterAll(async () => {
    if (!hasPostgres) return;
    await psql("postgres", `DROP DATABASE IF EXISTS ${DB}`);
  });

  it("denies anon and authenticated and allows service_role", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "social-rpc-"));
    await fs.chmod(dir, 0o755);
    const setupPath = path.join(dir, "setup.sql");
    await fs.writeFile(
      setupPath,
      `
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._rls_deny_client_access(table_name text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS api_deny_anon ON public.%I', table_name);
  EXECUTE format('DROP POLICY IF EXISTS api_deny_authenticated ON public.%I', table_name);
  EXECUTE format('CREATE POLICY api_deny_anon ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)', table_name);
  EXECUTE format('CREATE POLICY api_deny_authenticated ON public.%I FOR ALL TO authenticated USING (false) WITH CHECK (false)', table_name);
END;
$$;

CREATE TABLE public.users (id uuid PRIMARY KEY);
CREATE TABLE public.posts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.post_comments (
  id uuid PRIMARY KEY,
  post_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.follows (follower_id uuid, followee_id uuid);
`,
    );
    await fs.chmod(setupPath, 0o644);

    await psql("postgres", `DROP DATABASE IF EXISTS ${DB}`);
    const created = await psql("postgres", `CREATE DATABASE ${DB}`);
    expect(created.ok, created.stderr).toBe(true);
    await fs.writeFile(
      path.join(dir, "view.sql"),
      `
CREATE OR REPLACE VIEW public.usage_daily_summary AS
SELECT NULL::text AS user_id, NULL::date AS day, 0::bigint AS total, 'terminal_command'::text AS source
WHERE false;
`,
    );
    await fs.chmod(path.join(dir, "view.sql"), 0o644);
    await psqlFile(DB, setupPath);
    await psqlFile(DB, path.join(root, "supabase/migrations/20260916010000_social_phase1.sql"));
    await psqlFile(DB, path.join(dir, "view.sql"));

    const seeded = await psql(
      DB,
      `
INSERT INTO public.users (id) VALUES ('${USER_ID}');
INSERT INTO public.posts (id, user_id) VALUES ('${POST_ID}', '${USER_ID}');
INSERT INTO public.post_polls (id, post_id, question) VALUES ('${POLL_ID}', '${POST_ID}', 'q');
INSERT INTO public.poll_options (id, poll_id, text, position) VALUES ('${OPTION_ID}', '${POLL_ID}', 'a', 0);
INSERT INTO public.post_comments (id) VALUES ('${COMMENT_ID}');
`,
    );
    expect(seeded.ok, seeded.stderr).toBe(true);

    const before = await psql(
      DB,
      `
SELECT string_agg(
  proname || ':' || has_function_privilege('anon', oid, 'EXECUTE')::text || ':' || COALESCE(proacl::text, 'default-public'),
  ',' ORDER BY proname
)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'increment_post_reposts','decrement_post_reposts',
    'increment_post_saves','decrement_post_saves','increment_post_shares',
    'increment_poll_option_votes','increment_comment_likes','decrement_comment_likes'
  );
`,
    );
    expect(before.ok, before.stderr).toBe(true);
    for (const row of before.stdout.split(",")) {
      expect(row.endsWith(":true:default-public"), row).toBe(true);
    }

    const granted = await psql(
      DB,
      "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;",
    );
    expect(granted.ok, granted.stderr).toBe(true);

    const anonBefore = await psql(DB, `SET ROLE anon; SELECT public.increment_post_reposts('${POST_ID}');`);
    expect(anonBefore.ok, anonBefore.stderr).toBe(true);
    const bumped = await psql(DB, "SELECT reposts_count FROM public.posts");
    expect(bumped.stdout).toBe("1");

    const migration = path.join(root, "supabase/migrations/20260928010000_enable_rls_social_tables_and_usage_view.sql");
    await psqlFile(DB, migration);

    for (const role of ["anon", "authenticated"] as const) {
      for (const call of CALLS) {
        const result = await psql(DB, `SET ROLE ${role}; ${call};`);
        expect(result.ok, `${role} ${call} ${result.stderr}`).toBe(false);
        expect(result.stderr).toMatch(/42501|permission denied for function/);
      }
    }

    for (const call of CALLS) {
      const result = await psql(DB, `SET ROLE service_role; ${call};`);
      expect(result.ok, `service_role ${call} ${result.stderr}`).toBe(true);
    }

    const counts = await psql(
      DB,
      "SELECT reposts_count || ',' || saves_count || ',' || shares_count FROM public.posts",
    );
    expect(counts.stdout).toBe("1,0,1");
    const votes = await psql(DB, `SELECT votes_count FROM public.poll_options WHERE id = '${OPTION_ID}'`);
    expect(votes.stdout).toBe("1");
    const likes = await psql(DB, `SELECT likes_count FROM public.post_comments WHERE id = '${COMMENT_ID}'`);
    expect(likes.stdout).toBe("0");

    const privileges = await psql(
      DB,
      `
SELECT string_agg(
  proname || ':' ||
  has_function_privilege('anon', oid, 'EXECUTE')::text || ':' ||
  has_function_privilege('authenticated', oid, 'EXECUTE')::text || ':' ||
  has_function_privilege('service_role', oid, 'EXECUTE')::text || ':' ||
  COALESCE((
    SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
    FROM aclexplode(proacl) a
  ), false)::text,
  ',' ORDER BY proname
)
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'increment_post_reposts','decrement_post_reposts',
    'increment_post_saves','decrement_post_saves','increment_post_shares',
    'increment_poll_option_votes','increment_comment_likes','decrement_comment_likes'
  );
`,
    );
    expect(privileges.ok, privileges.stderr).toBe(true);
    for (const row of privileges.stdout.split(",")) {
      expect(row.endsWith(":false:false:true:false"), row).toBe(true);
    }

    await psqlFile(DB, migration);
    const again = await psql(
      DB,
      "SELECT has_function_privilege('anon', 'public.increment_post_reposts(uuid)', 'EXECUTE')::text",
    );
    expect(again.stdout).toBe("false");
    const serviceAgain = await psql(
      DB,
      `SET ROLE service_role; SELECT public.increment_post_shares('${POST_ID}');`,
    );
    expect(serviceAgain.ok, serviceAgain.stderr).toBe(true);
  }, 60_000);
});
