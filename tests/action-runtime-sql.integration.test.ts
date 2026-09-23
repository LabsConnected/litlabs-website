// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { Client } from "pg";

const execFileAsync = promisify(execFile);
const CONTAINER_NAME = `litt-action-runtime-${process.pid}`;
const PG_PORT = 45000 + (process.pid % 10000);
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;

let client: Client;

const PRE_ACTION_CONTEXT_MIGRATIONS = [
  "20260808220000_agent_paused_runs.sql",
  "20260810160000_browser_agent_sessions.sql",
  "20260913070000_add_run_status_to_paused_runs.sql",
  "20260917010000_add_quality_loop_state_to_paused_runs.sql",
  "20260917180000_add_batch_remainder_to_paused_runs.sql",
  "20260918120000_paused_runs_ttl_30min.sql",
  "20260920000000_paused_run_lease.sql",
  "20260923000000_action_runtime.sql",
  "20260923010000_browser_action_runtime_hardening.sql",
  "20260923020000_action_runtime_final_gate.sql",
  "20260923030000_action_runtime_lockdown.sql",
];
const ACTION_CONTEXT_MIGRATION = "20260923040000_action_execution_context.sql";

async function docker(args: string[]) {
  return execFileAsync("docker", args, { timeout: 120_000 });
}

async function waitForPostgres() {
  for (let i = 0; i < 45; i++) {
    try {
      const { stdout } = await docker(["exec", CONTAINER_NAME, "pg_isready", "-U", "postgres"]);
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

async function createRun(input: {
  id?: string;
  userId?: string;
  kind?: string;
  idempotencyKey?: string;
  status?: string;
} = {}) {
  const id = input.id ?? randomUUID();
  const result = await client.query(
    `SELECT * FROM public.action_runtime_create_run(
      $1::uuid, $2::text, NULL, $3::text, $4::text, 'initial activity', NULL, $5::text
    )`,
    [id, input.userId ?? "user-one", "conversation-one", input.kind ?? "composite", input.idempotencyKey ?? null],
  );
  const run = result.rows[0];
  if (input.status && input.status !== "queued") {
    const transitioned = await client.query(
      `SELECT * FROM public.action_runtime_transition($1::uuid, $2::text, $3::text, '{}'::jsonb, 'run.status', '{}'::jsonb)`,
      [run.id, input.userId ?? "user-one", input.status],
    );
    return transitioned.rows[0];
  }
  return run;
}

async function eventCount(runId: string) {
  const result = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM public.action_events WHERE run_id = $1",
    [runId],
  );
  return Number(result.rows[0].count);
}

async function runStatus(runId: string) {
  const result = await client.query("SELECT status, current_activity FROM public.action_runs WHERE id = $1", [runId]);
  return result.rows[0];
}

async function expectSqlError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ message: expect.stringContaining(code) });
}

describe("Action Runtime SQL invariants", () => {
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
    await client.connect();
    await client.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS text
      LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
      CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
      LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE litt_unpriv NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
    for (const migration of PRE_ACTION_CONTEXT_MIGRATIONS) {
      await applySql(path.join("supabase", "migrations", migration));
    }

    // Production-shaped upgrade fixture: an existing user's pending approval
    // and an already-resolved approval exist before action_run_id lands. The
    // new column must remain nullable for these rows rather than requiring a
    // destructive backfill or orphaning the old gates.
    await client.query(`
      INSERT INTO public.agent_paused_runs (
        id, user_id, conversation_id, project_id, workspace_id,
        tool_id, tool_call_id, inputs, reason, paused_messages,
        execution_mode, system_prompt, checkpoint_id, status,
        run_status, run_result, quality_loop_state,
        deferred_tool_calls, steps_used, had_intervening_mutation,
        lease_expires_at, last_progress_at, execution_token
      ) VALUES
        (
          '11111111-1111-4111-8111-111111111111',
          'user-one', 'conversation-one', 'project-one', 'workspace-one',
          'project.deploy', 'tc-old-pending', '{"source":"pre-upgrade"}',
          'Sensitive action — requires explicit approval',
          '[{"role":"user","content":"ship it"}]',
          'act', 'system', 'checkpoint-old', 'pending',
          NULL, NULL, '{"filesWritten":["index.html"]}',
          '[{"toolId":"preview.inspect","toolCallId":"tc-next","inputs":{}}]',
          3, true,
          now() + interval '10 minutes', now(), gen_random_uuid()
        ),
        (
          '22222222-2222-4222-8222-222222222222',
          'user-one', 'conversation-old', 'project-old', 'workspace-old',
          'files.write', 'tc-old-approved', '{}', 'approved before upgrade',
          '[]', 'act', 'system', NULL, 'approved',
          'completed', '{"success":true}', NULL,
          NULL, 1, true,
          NULL, NULL, NULL
        )
    `);

    await applySql(path.join("supabase", "migrations", ACTION_CONTEXT_MIGRATION));
    // The deployment runner may replay a repaired migration history; the
    // context upgrade itself must be idempotent, not just forward-only.
    await applySql(path.join("supabase", "migrations", ACTION_CONTEXT_MIGRATION));
  }, 180_000);

  afterAll(async () => {
    await client?.end().catch(() => undefined);
    await docker(["rm", "-f", CONTAINER_NAME]).catch(() => undefined);
  });

  it("makes logical ActionRun creation retries idempotent", async () => {
    const first = await createRun({ idempotencyKey: "request-one" });
    const retry = await createRun({ idempotencyKey: "request-one" });
    const fixedId = randomUUID();
    const byId = await createRun({ id: fixedId });
    const byIdRetry = await createRun({ id: fixedId });

    expect(retry.id).toBe(first.id);
    expect(byIdRetry.id).toBe(byId.id);
    expect(await eventCount(first.id)).toBe(1);
    expect(await eventCount(fixedId)).toBe(1);
  });

  it("returns real activity event identity and exact BIGINT sequence", async () => {
    const run = await createRun();
    const sequenceName = await client.query<{ seq: string }>(
      "SELECT pg_get_serial_sequence('public.action_events', 'sequence') AS seq",
    );
    await client.query("SELECT setval($1, 9007199254740992)", [sequenceName.rows[0].seq]);

    const result = await client.query(
      "SELECT public.action_runtime_activity($1::uuid, 'user-one', 'deployment verified') AS result",
      [run.id],
    );
    const event = result.rows[0].result.event;

    expect(event.id).not.toBe(run.id);
    expect(event.run_id).toBe(run.id);
    expect(event.sequence).toBe("9007199254740993");
    expect(typeof event.sequence).toBe("string");
  });

  it("rejects an invalid transition without mutating status, events, or activity", async () => {
    const run = await createRun();

    await expectSqlError(
      client.query(`SELECT public.action_runtime_transition_event_activity(
        $1::uuid, 'user-one', 'completed', '{}'::jsonb,
        'browser.action.completed', '{}'::jsonb, 'mutated'
      )`, [run.id]),
      "ACTION_RUN_INVALID_TRANSITION",
    );

    expect(await runStatus(run.id)).toEqual({ status: "queued", current_activity: "initial activity" });
    expect(await eventCount(run.id)).toBe(1);
  });

  it("rejects an invalid event type without mutating anything", async () => {
    const run = await createRun();

    await expectSqlError(
      client.query(`SELECT public.action_runtime_transition_event_activity(
        $1::uuid, 'user-one', 'working', '{}'::jsonb,
        'not-a-real-event', '{}'::jsonb, 'mutated'
      )`, [run.id]),
      "ACTION_EVENT_INVALID_TYPE",
    );

    expect(await runStatus(run.id)).toEqual({ status: "queued", current_activity: "initial activity" });
    expect(await eventCount(run.id)).toBe(1);
  });

  it("rejects cross-user mutation without mutating the run", async () => {
    const run = await createRun();

    await expectSqlError(
      client.query(`SELECT public.action_runtime_transition_event_activity(
        $1::uuid, 'user-two', 'working', '{}'::jsonb,
        'browser.action.started', '{}'::jsonb, 'cross user'
      )`, [run.id]),
      "ACTION_RUN_NOT_FOUND",
    );

    expect(await runStatus(run.id)).toEqual({ status: "queued", current_activity: "initial activity" });
    expect(await eventCount(run.id)).toBe(1);
  });

  it("rejects terminal run patches atomically", async () => {
    const run = await createRun({ status: "working" });
    await client.query(
      `SELECT public.action_runtime_transition($1::uuid, 'user-one', 'completed', $2::jsonb, 'run.completed', '{}'::jsonb)`,
      [run.id, JSON.stringify({ currentActivity: "done" })],
    );

    await expectSqlError(
      client.query(`SELECT public.action_runtime_transition(
        $1::uuid, 'user-one', 'completed', $2::jsonb, 'run.status', '{}'::jsonb
      )`, [run.id, JSON.stringify({ currentActivity: "terminal patch" })]),
      "ACTION_RUN_TERMINAL_IMMUTABLE",
    );

    expect(await runStatus(run.id)).toEqual({ status: "completed", current_activity: "done" });
    expect(await eventCount(run.id)).toBe(3);
  });

  it("enforces one ActionRun per browser session and browser owner isolation", async () => {
    const sessionId = randomUUID();
    const foreignSessionId = randomUUID();
    await client.query(
      "INSERT INTO public.browser_sessions (id, user_id, status) VALUES ($1, 'user-one', 'active'), ($2, 'user-two', 'active')",
      [sessionId, foreignSessionId],
    );
    const runOne = await createRun();
    const runTwo = await createRun();

    await client.query(
      "SELECT public.action_runtime_attach_browser_session($1::uuid, 'user-one', $2::uuid, 'provider-one')",
      [runOne.id, sessionId],
    );

    await expectSqlError(
      client.query("SELECT public.action_runtime_attach_browser_session($1::uuid, 'user-one', $2::uuid, 'provider-two')", [runTwo.id, sessionId]),
      "ACTION_BROWSER_SESSION_MISMATCH",
    );
    await expectSqlError(
      client.query("SELECT public.action_runtime_attach_browser_session($1::uuid, 'user-one', $2::uuid, 'provider-three')", [runTwo.id, foreignSessionId]),
      "ACTION_BROWSER_SESSION_OWNER_MISMATCH",
    );
  });

  it("restricts mutation RPC execution to service_role", async () => {
    const run = await createRun();
    for (const role of ["litt_unpriv", "anon", "authenticated"]) {
      await client.query(`SET ROLE ${role}`);
      await expect(
        client.query(
          "SELECT public.action_runtime_transition($1::uuid, 'user-one', 'working', '{}'::jsonb, 'run.status', '{}'::jsonb)",
          [run.id],
        ),
      ).rejects.toThrow(/permission denied/i);
      await client.query("RESET ROLE");
    }

    await client.query("SET ROLE service_role");
    await client.query(
      "SELECT public.action_runtime_transition($1::uuid, 'user-one', 'working', '{}'::jsonb, 'run.status', '{}'::jsonb)",
      [run.id],
    );
    await client.query("RESET ROLE");
    expect((await runStatus(run.id)).status).toBe("working");
  });

  it("rejects an event whose user_id differs from the run owner structurally", async () => {
    const run = await createRun();
    await expect(
      client.query(
        "INSERT INTO public.action_events (run_id, user_id, type, payload) VALUES ($1, 'user-two', 'run.status', '{}')",
        [run.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects a browser session attached to a different owner structurally", async () => {
    const foreignSessionId = randomUUID();
    await client.query(
      "INSERT INTO public.browser_sessions (id, user_id, status) VALUES ($1, 'user-two', 'active')",
      [foreignSessionId],
    );
    const run = await createRun();
    await expect(
      client.query("UPDATE public.action_runs SET browser_session_id = $1 WHERE id = $2", [foreignSessionId, run.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects unknown event types at the table level", async () => {
    const run = await createRun();
    await expect(
      client.query(
        "INSERT INTO public.action_events (run_id, user_id, type, payload) VALUES ($1, 'user-one', 'not.a.real.event', '{}')",
        [run.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts canonical composite tool and preview lifecycle event types", async () => {
    const run = await createRun();
    await client.query(
      "INSERT INTO public.action_events (run_id, user_id, type, payload) VALUES ($1, 'user-one', 'tool.started', '{\"toolId\":\"files.write\"}'), ($1, 'user-one', 'preview.ready', '{\"workspaceId\":\"ws-one\"}')",
      [run.id],
    );

    const events = await client.query<{ type: string }>(
      "SELECT type FROM public.action_events WHERE run_id = $1 AND type IN ('tool.started', 'preview.ready')",
      [run.id],
    );
    expect(events.rows.map((row) => row.type)).toEqual(["tool.started", "preview.ready"]);
  });

  it("migrates pre-existing paused runs without a destructive backfill", async () => {
    const rows = await client.query<{ id: string; action_run_id: string | null; status: string }>(
      `SELECT id::text, action_run_id::text, status
       FROM public.agent_paused_runs
       WHERE id IN (
         '11111111-1111-4111-8111-111111111111',
         '22222222-2222-4222-8222-222222222222'
       )
       ORDER BY id`,
    );

    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.status)).toEqual(["pending", "approved"]);
    expect(rows.rows.every((row) => row.action_run_id === null)).toBe(true);
  });

  it("lets an old pending approval bind to a same-tenant ActionRun and resume", async () => {
    const run = await createRun({ userId: "user-one" });
    const pausedRunId = "11111111-1111-4111-8111-111111111111";

    await client.query(
      `UPDATE public.agent_paused_runs
       SET action_run_id = $1
       WHERE id = $2 AND user_id = 'user-one'`,
      [run.id, pausedRunId],
    );
    await client.query(
      `UPDATE public.agent_paused_runs
       SET status = 'approved', resolved_at = now(), run_status = 'processing', run_started_at = now()
       WHERE id = $1 AND user_id = 'user-one' AND status = 'pending'`,
      [pausedRunId],
    );

    const row = await client.query<{
      status: string;
      run_status: string | null;
      action_run_id: string | null;
      deferred_tool_calls: unknown;
    }>(
      `SELECT status, run_status, action_run_id::text, deferred_tool_calls
       FROM public.agent_paused_runs WHERE id = $1`,
      [pausedRunId],
    );

    expect(row.rows[0]).toMatchObject({
      status: "approved",
      run_status: "processing",
      action_run_id: run.id,
    });
    expect(row.rows[0].deferred_tool_calls).toEqual([
      { toolId: "preview.inspect", toolCallId: "tc-next", inputs: {} },
    ]);
  });

  it("enforces tenant ownership on paused-run parent ActionRun references", async () => {
    const foreignRun = await createRun({ userId: "user-two" });
    await expect(
      client.query(
        `INSERT INTO public.agent_paused_runs
          (user_id, conversation_id, project_id, workspace_id, tool_id, tool_call_id, reason, action_run_id)
         VALUES ('user-one', 'conversation-one', 'project-one', 'workspace-one', 'files.write', 'tc-one', 'approval', $1)`,
        [foreignRun.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("blocks deleting a parent run that still owns an approval record", async () => {
    const run = await createRun({ userId: "user-one" });
    await client.query(
      `INSERT INTO public.agent_paused_runs
        (user_id, conversation_id, project_id, workspace_id, tool_id, tool_call_id, reason, action_run_id)
       VALUES ('user-one', 'conversation-delete', 'project-one', 'workspace-one', 'files.write', 'tc-delete', 'approval', $1)`,
      [run.id],
    );

    await expect(
      client.query("DELETE FROM public.action_runs WHERE id = $1 AND user_id = 'user-one'", [run.id]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("creates the action_run_id/status lookup index used by approval projection", async () => {
    const result = await client.query<{ column: string }>(
      `SELECT a.attname AS column
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE n.nspname = 'public'
         AND t.relname = 'agent_paused_runs'
         AND i.indexrelid = 'public.idx_agent_paused_runs_action_run'::regclass
       ORDER BY k.ord`,
    );
    expect(result.rows.map((row) => row.column)).toEqual(["action_run_id", "status"]);
  });

  it("returns terminal runs idempotently for same-status no-op patches", async () => {
    const run = await createRun({ status: "working" });
    await client.query(
      `SELECT public.action_runtime_transition($1::uuid, 'user-one', 'completed', $2::jsonb, 'run.completed', '{}'::jsonb)`,
      [run.id, JSON.stringify({ currentActivity: "done" })],
    );
    const eventsBefore = await eventCount(run.id);

    const replay = await client.query(
      `SELECT * FROM public.action_runtime_transition(
        $1::uuid, 'user-one', 'completed', $2::jsonb, 'run.status', '{}'::jsonb
      )`,
      [run.id, JSON.stringify({ currentActivity: "done" })],
    );

    expect(replay.rows[0].status).toBe("completed");
    expect(replay.rows[0].current_activity).toBe("done");
    expect(await eventCount(run.id)).toBe(eventsBefore);
  });

  it("emits exactly one cancellation.requested event on repeated cancellation", async () => {
    const run = await createRun({ status: "working" });
    await client.query("SELECT public.action_runtime_request_cancellation($1::uuid, 'user-one', now())", [run.id]);
    await client.query("SELECT public.action_runtime_request_cancellation($1::uuid, 'user-one', now())", [run.id]);

    const result = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.action_events WHERE run_id = $1 AND type = 'cancellation.requested'",
      [run.id],
    );
    expect(Number(result.rows[0].count)).toBe(1);
  });

  it("assigns strictly increasing event sequences", async () => {
    const run = await createRun();
    for (let i = 0; i < 3; i++) {
      await client.query("SELECT public.action_runtime_append_event($1::uuid, 'user-one', 'agent.status', '{}'::jsonb)", [run.id]);
    }
    const result = await client.query<{ sequence: string }>(
      "SELECT sequence::text AS sequence FROM public.action_events WHERE run_id = $1 ORDER BY sequence",
      [run.id],
    );
    const sequences = result.rows.map((r) => BigInt(r.sequence));
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i] > sequences[i - 1]).toBe(true);
    }
  });

  it("sets started_at on queued -> working and never rewrites it", async () => {
    const run = await createRun();
    expect(run.started_at).toBeNull();

    const working = await client.query(
      "SELECT * FROM public.action_runtime_transition($1::uuid, 'user-one', 'working', '{}'::jsonb, 'run.started', '{}'::jsonb)",
      [run.id],
    );
    const startedAt = working.rows[0].started_at;
    expect(startedAt).not.toBeNull();

    await client.query(
      "SELECT public.action_runtime_transition($1::uuid, 'user-one', 'paused', '{}'::jsonb, 'run.status', '{}'::jsonb)",
      [run.id],
    );
    const resumed = await client.query(
      "SELECT * FROM public.action_runtime_transition($1::uuid, 'user-one', 'working', '{}'::jsonb, 'run.status', '{}'::jsonb)",
      [run.id],
    );
    expect(resumed.rows[0].started_at).toEqual(startedAt);
  });

  it("rejects queued -> paused (a never-executed run is not paused work)", async () => {
    const run = await createRun();
    await expectSqlError(
      client.query(
        "SELECT public.action_runtime_transition($1::uuid, 'user-one', 'paused', '{}'::jsonb, 'run.status', '{}'::jsonb)",
        [run.id],
      ),
      "ACTION_RUN_INVALID_TRANSITION",
    );
    expect((await runStatus(run.id)).status).toBe("queued");
  });

  it("serializes concurrent browser find-or-create to one run and one event", async () => {
    // Two connections racing the same logical task: the advisory lock
    // serializes them so the loser finds the winner's run instead of
    // inserting a second one.
    const second = new Client({ connectionString: DATABASE_URL });
    await second.connect();
    try {
      const conversationId = `conv-${randomUUID()}`;
      const [a, b] = await Promise.all([
        client.query(
          `SELECT * FROM public.action_runtime_find_or_create_browser_run($1::uuid, 'user-one', NULL, $2::text)`,
          [randomUUID(), conversationId],
        ),
        second.query(
          `SELECT * FROM public.action_runtime_find_or_create_browser_run($1::uuid, 'user-one', NULL, $2::text)`,
          [randomUUID(), conversationId],
        ),
      ]);

      expect(a.rows[0].id).toBe(b.rows[0].id);
      expect(await eventCount(a.rows[0].id)).toBe(1);
      const runs = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.action_runs WHERE conversation_id = $1 AND kind = 'browser'",
        [conversationId],
      );
      expect(Number(runs.rows[0].count)).toBe(1);
    } finally {
      await second.end().catch(() => undefined);
    }
  });

  it("never persists activity.created with a null message via event_activity", async () => {
    const run = await createRun();
    await client.query(
      "SELECT public.action_runtime_event_activity($1::uuid, 'user-one', 'agent.status', '{}'::jsonb, NULL)",
      [run.id],
    );

    const events = await client.query<{ type: string; payload: { message?: string | null } }>(
      "SELECT type, payload FROM public.action_events WHERE run_id = $1 ORDER BY sequence",
      [run.id],
    );
    const activityEvents = events.rows.filter((e) => e.type === "activity.created");
    expect(activityEvents).toHaveLength(0);
    expect(events.rows.some((e) => e.type === "agent.status")).toBe(true);

    await expectSqlError(
      client.query(
        "SELECT public.action_runtime_event_activity($1::uuid, 'user-one', 'activity.created', '{}'::jsonb, 'msg')",
        [run.id],
      ),
      "ACTION_EVENT_INVALID_TYPE",
    );
  });
});
