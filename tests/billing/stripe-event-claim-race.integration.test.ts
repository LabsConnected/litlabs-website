// @vitest-environment node
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Two stale webhook retries must not both process one Stripe event.
 * The claim token is checked on takeover, finalize, and release.
 *
 * Skips when Postgres is down unless BILLING_REQUIRE_DB=1.
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
  throw new Error(`BILLING_REQUIRE_DB: claim database is unreachable at ${DATABASE_URL}`);
}

function connect(): Client {
  return new Client({ connectionString: DATABASE_URL });
}

describe.skipIf(!dbUp)("stripe event claim token", () => {
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
        CREATE TABLE IF NOT EXISTS public.stripe_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          stripe_event_id text NOT NULL UNIQUE,
          event_type text NOT NULL,
          processed_at timestamptz NOT NULL DEFAULT now(),
          result text,
          metadata jsonb
        );
        CREATE TABLE IF NOT EXISTS public.users (
          id uuid PRIMARY KEY,
          clerk_id text
        );
        CREATE TABLE IF NOT EXISTS public.subscriptions (
          user_id uuid PRIMARY KEY,
          status text,
          stripe_subscription_id text
        );
      `);
      await client.query(readFileSync(
        "supabase/migrations/20261015160000_checkout_reservations.sql",
        "utf8",
      ));
      await client.query(readFileSync(
        "supabase/migrations/20261015210000_checkout_session_lease.sql",
        "utf8",
      ));
      await client.query(readFileSync(
        "supabase/migrations/20261015230000_checkout_block_protected_subscription.sql",
        "utf8",
      ));
      await client.query(readFileSync(
        "supabase/migrations/20261015240000_stripe_event_claim_token.sql",
        "utf8",
      ));
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.claim_work (
          id bigserial PRIMARY KEY,
          stripe_event_id text NOT NULL,
          claim_token uuid NOT NULL
        );
      `);
    } finally {
      await client.end();
    }
  }, 30_000);

  it("lets only one of two stale retries own, finalize, and record work", async () => {
    const admin = connect();
    const left = connect();
    const right = connect();
    await Promise.all([admin.connect(), left.connect(), right.connect()]);
    const eventId = `evt_claim_race_${crypto.randomUUID()}`;
    const staleToken = "11111111-1111-4111-8111-111111111111";
    try {
      await admin.query(
        `INSERT INTO public.stripe_events (stripe_event_id, event_type, result, claim_token, processed_at)
         VALUES ($1, 'invoice.paid', 'processing', $2::uuid, now() - interval '10 minutes')`,
        [eventId, staleToken],
      );
      const claim = (client: Client, token: string) =>
        client.query(
          `SELECT public.claim_stripe_event($1, 'invoice.paid', $2::uuid, now() - interval '2 minutes') AS status`,
          [eventId, token],
        );
      const tokenA = crypto.randomUUID();
      const tokenB = crypto.randomUUID();
      const [a, b] = await Promise.all([claim(left, tokenA), claim(right, tokenB)]);
      const statuses = [a.rows[0].status, b.rows[0].status].sort();
      expect(statuses).toEqual(["in_progress", "owned"]);
      const winner = a.rows[0].status === "owned" ? tokenA : tokenB;
      const loser = winner === tokenA ? tokenB : tokenA;

      await left.query(
        `INSERT INTO public.claim_work (stripe_event_id, claim_token)
         SELECT $1, $2::uuid
         WHERE public.finalize_stripe_event($1, $2::uuid, 'processed')`,
        [eventId, winner],
      );
      const loserFinalize = await right.query(
        `SELECT public.finalize_stripe_event($1, $2::uuid, 'processed') AS ok`,
        [eventId, loser],
      );
      expect(loserFinalize.rows[0].ok).toBe(false);
      const staleRelease = await right.query(
        `SELECT public.release_stripe_event($1, $2::uuid) AS status`,
        [eventId, staleToken],
      );
      expect(staleRelease.rows[0].status).toBe("lost");
      const stored = await admin.query(
        `SELECT result, claim_token::text AS claim_token FROM public.stripe_events WHERE stripe_event_id = $1`,
        [eventId],
      );
      expect(stored.rows).toEqual([{ result: "processed", claim_token: winner }]);
      const work = await admin.query(
        `SELECT claim_token::text AS claim_token FROM public.claim_work WHERE stripe_event_id = $1`,
        [eventId],
      );
      expect(work.rows).toEqual([{ claim_token: winner }]);
    } finally {
      await admin.query(`DELETE FROM public.claim_work WHERE stripe_event_id = $1`, [eventId]);
      await admin.query(`DELETE FROM public.stripe_events WHERE stripe_event_id = $1`, [eventId]);
      await Promise.all([admin.end(), left.end(), right.end()]);
    }
  });

  it("blocks checkout for unpaid, paused, incomplete, and refunded", async () => {
    const client = connect();
    await client.connect();
    const userId = crypto.randomUUID();
    try {
      await client.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text`);
      await client.query(
        `INSERT INTO public.users (id, clerk_id, email) VALUES ($1, $2, $3)`,
        [userId, `clerk_${userId}`, `${userId}@billing.test`],
      );
      for (const status of ["unpaid", "paused", "incomplete", "refunded"]) {
        await client.query(
          `INSERT INTO public.subscriptions (user_id, status, stripe_subscription_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET status = EXCLUDED.status, stripe_subscription_id = EXCLUDED.stripe_subscription_id`,
          [userId, status, `sub_${status}`],
        );
        const decision = await client.query(
          `SELECT public.begin_checkout_reservation(
             $1, $2::uuid, 'creator_beta', 'price_creator', now(), 1860
           ) AS decision`,
          [`clerk_${userId}`, userId],
        );
        expect(decision.rows[0].decision.action).toBe("already_subscribed");
      }
    } finally {
      await client.query(`DELETE FROM public.checkout_reservations WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM public.subscriptions WHERE user_id = $1`, [userId]);
      await client.query(`DELETE FROM public.users WHERE id = $1`, [userId]);
      await client.end();
    }
  });
});
