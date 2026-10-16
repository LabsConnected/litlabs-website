// @vitest-environment node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const sql = readFileSync("scripts/billing-migration-precheck.sql", "utf8");
const shell = readFileSync("scripts/billing-migration-precheck.sh", "utf8");

describe("billing migration precheck", () => {
  it("orders migrations before code and records a rollback for each", () => {
    for (const file of [
      "20261014000000_subscriptions_stripe_subscription_id_unique.sql",
      "20261015000000_subscriptions_cancel_at_period_end.sql",
      "20261015120000_media_cap_holds.sql",
      "20261015140000_subscriptions_last_stripe_event_created.sql",
      "20261015160000_checkout_reservations.sql",
      "20261015170000_billing_subscription_conflicts.sql",
      "20261015180000_media_cap_hold_expiry.sql",
      "20261015200000_apply_subscription_event.sql",
      "20261015210000_checkout_session_lease.sql",
      "20261015220000_schedule_media_cap_sweep.sql",
    ]) {
      expect(sql).toContain(file);
      expect(shell).toContain(file);
    }
    expect(sql).toContain("before the application code");
    expect(sql).toContain("DROP INDEX IF EXISTS public.subscriptions_stripe_subscription_id_uidx");
    expect(sql).toContain("DROP COLUMN IF EXISTS cancel_at_period_end");
    expect(sql).toContain("Do not drop it");
    expect(sql).toContain("DROP TABLE IF EXISTS public.media_cap_holds");
    expect(sql).toContain("DROP COLUMN IF EXISTS last_stripe_event_created");
    expect(shell).toContain("DROP COLUMN IF EXISTS last_stripe_event_created");
    expect(sql).toContain("DROP TABLE IF EXISTS public.checkout_reservations");
    expect(sql).toContain("DROP TABLE IF EXISTS public.billing_subscription_conflicts");
    expect(sql).toContain("DROP COLUMN IF EXISTS settled_at");
    expect(sql).toContain("DROP INDEX IF EXISTS public.subscriptions_one_protected_per_user");
    expect(sql).toContain("apply_subscription_event");
    expect(shell).toContain("DROP INDEX public.subscriptions_one_protected_per_user");
    expect(sql).toContain("protected subscription");
    expect(shell).toContain("DROP TABLE public.checkout_reservations");
    expect(shell).toContain("DROP TABLE public.billing_subscription_conflicts");
    expect(sql).toContain("stripe_subscription_id");
    expect(sql).toContain("generation_jobs");
    expect(sql).toContain("public.users");
  });

  it("does not apply schema changes", () => {
    const executable = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
    expect(executable).not.toMatch(/\b(CREATE|ALTER|DROP)\b/i);
  });

  it("prints the order without a database", () => {
    const output = execFileSync("bash", ["scripts/billing-migration-precheck.sh", "--print"], {
      encoding: "utf8",
    });
    expect(output).toContain("migrations run before the application code");
    expect(output).toContain("20261014000000");
    expect(output).toContain("20261015120000");
    expect(output).toContain("20261015140000");
  });
});
