// @vitest-environment node
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Concurrent first-time checkout and media-hold expiry against local Postgres.
 * Skips when the database is unreachable so CI without this cluster still runs.
 * This environment uses postgresql://litlabs_test@127.0.0.1:5432/litlabs_billing.
 */
const DATABASE_URL =
  process.env.BILLING_TEST_DATABASE_URL ??
  "postgresql://litlabs_test:litlabs_test@127.0.0.1:5432/litlabs_billing";

async function canConnect(): Promise<boolean> {
  const client = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbUp = await canConnect();
if ((process.env.BILLING_REQUIRE_DB === "1" || process.env.RUN_BILLING_CONCURRENCY_DB === "1") && !dbUp) {
  throw new Error(`BILLING_REQUIRE_DB: concurrency database is unreachable at ${DATABASE_URL}`);
}

function connect(): Client {
  return new Client({ connectionString: DATABASE_URL });
}

async function query<T extends Record<string, unknown>>(
  client: Client,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

describe.skipIf(!dbUp)("local billing database", () => {
  beforeAll(async () => {
    const client = connect();
    await client.connect();
    try {
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            CREATE ROLE anon NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            CREATE ROLE authenticated NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            CREATE ROLE service_role NOLOGIN;
          END IF;
        END $$;
        CREATE TABLE IF NOT EXISTS public.users (
          id uuid PRIMARY KEY,
          clerk_id text
        );
        ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;
        CREATE TABLE IF NOT EXISTS public.subscriptions (
          user_id uuid PRIMARY KEY,
          status text,
          stripe_subscription_id text,
          stripe_customer_id text
        );
        CREATE TABLE IF NOT EXISTS public.generation_jobs (
          id uuid PRIMARY KEY,
          user_id uuid,
          request_id text,
          created_at timestamptz,
          status text,
          refund_status text,
          provider text,
          model text,
          modality text,
          actual_provider_cost_cents integer
        );
        ALTER TABLE public.generation_jobs ADD COLUMN IF NOT EXISTS prompt text;
      `);
      for (const file of [
        "supabase/migrations/20261015120000_media_cap_holds.sql",
        "supabase/migrations/20261015160000_checkout_reservations.sql",
        "supabase/migrations/20261015170000_billing_subscription_conflicts.sql",
        "supabase/migrations/20261015180000_media_cap_hold_expiry.sql",
        "supabase/migrations/20261015210000_checkout_session_lease.sql",
        "supabase/migrations/20261015220000_schedule_media_cap_sweep.sql",
      ]) {
        await client.query(readFileSync(file, "utf8"));
      }
    } finally {
      await client.end();
    }
  }, 30_000);

  it("lets only one of two first-time checkouts create a session", async () => {
    const admin = connect();
    const creator = connect();
    const pro = connect();
    await Promise.all([admin.connect(), creator.connect(), pro.connect()]);
    const userId = crypto.randomUUID();
    const clerkId = `clerk_${userId}`;
    const now = new Date().toISOString();
    try {
      await admin.query(
        "INSERT INTO public.users (id, clerk_id, email) VALUES ($1, $2, $3)",
        [userId, clerkId, `${clerkId}@example.test`],
      );
      const begin = (client: Client, planId: string, priceId: string) =>
        query<{ decision: { action: string; token?: string; url?: string; price_id?: string; expire_session_id?: string | null } }>(
          client,
          `SELECT public.begin_checkout_reservation(
             $1, $2::uuid, $3, $4, $5::timestamptz, 60
           ) AS decision`,
          [clerkId, userId, planId, priceId, now],
        );
      const [creatorRows, proRows] = await Promise.all([
        begin(creator, "creator_beta", "price_creator"),
        begin(pro, "pro_builder_beta", "price_pro"),
      ]);
      const actions = [creatorRows[0].decision.action, proRows[0].decision.action].sort();
      expect(actions).toEqual(["create", "in_progress"]);

      const winner = [creatorRows[0].decision, proRows[0].decision].find(
        (decision) => decision.action === "create",
      );
      expect(winner?.token).toBeTruthy();
      const winnerPrice = creatorRows[0].decision.action === "create" ? "price_creator" : "price_pro";
      const otherPrice = winnerPrice === "price_creator" ? "price_pro" : "price_creator";
      const openUntil = new Date(Date.now() + 31 * 60 * 1000).toISOString();
      const committed = await query<{ committed: boolean }>(
        admin,
        `SELECT public.commit_checkout_reservation(
           $1, $2::uuid, $3, $4, $5::timestamptz
         ) AS committed`,
        [clerkId, winner!.token, "cs_test_open", "https://checkout.test/session", openUntil],
      );
      expect(committed[0].committed).toBe(true);

      const reuse = await begin(creator, "creator_beta", winnerPrice);
      expect(reuse[0].decision.action).toBe("reuse");
      expect(reuse[0].decision.url).toBe("https://checkout.test/session");
      const blocked = await begin(pro, "pro_builder_beta", otherPrice);
      expect(blocked[0].decision.action).toBe("replace");
      expect(blocked[0].decision.expire_session_id).toBe("cs_test_open");

      const expiredAt = new Date(Date.parse(now) - 60_000).toISOString();
      await admin.query(
        `UPDATE public.checkout_reservations
         SET status = 'open',
             stripe_session_id = 'cs_orphan',
             stripe_session_url = 'https://checkout.test/orphan',
             price_id = $2,
             expires_at = $3::timestamptz
         WHERE clerk_id = $1`,
        [clerkId, winnerPrice, expiredAt],
      );
      const orphan = await begin(creator, "creator_beta", otherPrice);
      expect(orphan[0].decision.action).toBe("create");
      expect(orphan[0].decision.expire_session_id).toBe("cs_orphan");
      const released = await query<{ n: string }>(
        admin,
        `WITH gone AS (
           SELECT public.release_checkout_reservation('cs_missing')
         )
         SELECT count(*)::text AS n FROM public.checkout_reservations WHERE clerk_id = $1`,
        [clerkId],
      );
      expect(released[0].n).toBe("1");

      const rows = await query<{ n: string }>(
        admin,
        "SELECT count(*)::text AS n FROM public.checkout_reservations WHERE clerk_id = $1",
        [clerkId],
      );
      expect(rows[0].n).toBe("1");
    } finally {
      await admin.query("DELETE FROM public.checkout_reservations WHERE clerk_id = $1", [clerkId]);
      await admin.query("DELETE FROM public.users WHERE id = $1", [userId]);
      await Promise.all([admin.end(), creator.end(), pro.end()]);
    }
  });

  it("releases a hold immediately and sweeps failed, aged, settled, and completed holds", async () => {
    const client = connect();
    await client.connect();
    const userId = crypto.randomUUID();
    try {
      await client.query("INSERT INTO public.users (id, clerk_id, email) VALUES ($1, $2, $3)", [
        userId,
        `clerk_${userId}`,
        `clerk_${userId}@example.test`,
      ]);
      const claim = (requestId: string) =>
        query<{ claim: { allowed: boolean; reason?: string } }>(
          client,
          `SELECT public.claim_media_cap_slot(
             $1::uuid, $2, 'image', 'gemini', 'gemini-2.5-flash-image',
             10, false, false, 1, 1, 100000, 8, 1, now()
           ) AS claim`,
          [userId, requestId],
        );
      const holdCount = (requestId: string) =>
        query<{ n: string }>(
          client,
          "SELECT count(*)::text AS n FROM public.media_cap_holds WHERE user_id = $1 AND request_id = $2",
          [userId, requestId],
        );

      const first = await claim("rel-1");
      expect(first[0].claim.allowed).toBe(true);
      const blocked = await claim("rel-2");
      expect(blocked[0].claim.allowed).toBe(false);
      await client.query("SELECT public.release_media_cap_hold($1::uuid, $2)", [userId, "rel-1"]);
      expect((await holdCount("rel-1"))[0].n).toBe("0");
      const afterRelease = await claim("rel-3");
      expect(afterRelease[0].claim.allowed).toBe(true);
      await client.query("SELECT public.release_media_cap_hold($1::uuid, $2)", [userId, "rel-3"]);

      await claim("fail-1");
      await client.query(
        `INSERT INTO public.generation_jobs (
           id, user_id, request_id, created_at, status, refund_status,
           provider, model, modality, actual_provider_cost_cents, prompt
         ) VALUES ($1, $2, 'fail-1', now(), 'failed', 'none', 'gemini', 'gemini-2.5-flash-image', 'image', 10, 'hold')`,
        [crypto.randomUUID(), userId],
      );
      const duringFailure = await claim("fail-2");
      expect(duringFailure[0].claim.allowed).toBe(true);
      await client.query("SELECT public.sweep_expired_media_cap_holds(now(), interval '24 hours')");
      expect((await holdCount("fail-1"))[0].n).toBe("0");
      await client.query("SELECT public.release_media_cap_hold($1::uuid, $2)", [userId, "fail-2"]);

      await claim("aged-1");
      await client.query(
        `UPDATE public.media_cap_holds
         SET created_at = now() - interval '25 hours'
         WHERE user_id = $1 AND request_id = 'aged-1'`,
        [userId],
      );
      const afterAge = await claim("aged-2");
      expect(afterAge[0].claim.allowed).toBe(true);
      await client.query("SELECT public.sweep_expired_media_cap_holds(now(), interval '24 hours')");
      expect((await holdCount("aged-1"))[0].n).toBe("0");
      expect((await holdCount("aged-2"))[0].n).toBe("1");
      await client.query("SELECT public.release_media_cap_hold($1::uuid, $2)", [userId, "aged-2"]);

      await claim("settled-1");
      await client.query("SELECT public.settle_media_cap_hold($1::uuid, 'settled-1', now())", [userId]);
      await client.query(
        `UPDATE public.media_cap_holds
         SET created_at = now() - interval '25 hours'
         WHERE user_id = $1 AND request_id = 'settled-1'`,
        [userId],
      );
      await client.query("SELECT public.sweep_expired_media_cap_holds(now(), interval '24 hours')");
      expect((await holdCount("settled-1"))[0].n).toBe("1");
      const settledBlocks = await claim("settled-2");
      expect(settledBlocks[0].claim.allowed).toBe(false);
      await client.query("DELETE FROM public.media_cap_holds WHERE user_id = $1 AND request_id = 'settled-1'", [userId]);

      await claim("done-1");
      await client.query(
        `INSERT INTO public.generation_jobs (
           id, user_id, request_id, created_at, status, refund_status,
           provider, model, modality, actual_provider_cost_cents, prompt
         ) VALUES ($1, $2, 'done-1', now() - interval '25 hours', 'completed', 'none', 'gemini', 'gemini-2.5-flash-image', 'image', 10, 'hold')`,
        [crypto.randomUUID(), userId],
      );
      await client.query(
        `UPDATE public.media_cap_holds
         SET created_at = now() - interval '25 hours'
         WHERE user_id = $1 AND request_id = 'done-1'`,
        [userId],
      );
      await client.query("SELECT public.sweep_expired_media_cap_holds(now(), interval '24 hours')");
      expect((await holdCount("done-1"))[0].n).toBe("1");
      const completedBlocks = await claim("done-2");
      expect(completedBlocks[0].claim.allowed).toBe(false);
    } finally {
      await client.query("DELETE FROM public.media_cap_holds WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM public.generation_jobs WHERE user_id = $1", [userId]);
      await client.query("DELETE FROM public.users WHERE id = $1", [userId]);
      await client.end();
    }
  });
});
