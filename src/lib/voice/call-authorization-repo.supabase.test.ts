import { describe, it, expect, vi } from "vitest";
import { createSupabaseCallAuthorizationRepo, type SupabaseLike } from "./call-authorization-repo.supabase";

/**
 * A tiny fake that satisfies SupabaseLike without any network layer.
 * `table` maps table name -> an array of "rows" (plain objects) used to
 * answer .eq().eq().maybeSingle(); `upsertSpy` records what would have
 * been written.
 */
function makeFakeClient(opts: {
  tables?: Record<string, Record<string, unknown>[]>;
  errorOn?: string[]; // table names that should return a query error
  upsertSpy?: ReturnType<typeof vi.fn>;
}): SupabaseLike {
  const tables = opts.tables ?? {};
  const errorOn = new Set(opts.errorOn ?? []);

  return {
    from(table: string) {
      return {
        select(_columns: string) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            async maybeSingle() {
              if (errorOn.has(table)) {
                return { data: null, error: { message: `simulated error on ${table}` } };
              }
              const rows = tables[table] ?? [];
              const match = rows.find((row) =>
                Object.entries(filters).every(([k, v]) => row[k] === v),
              );
              return { data: match ?? null, error: null };
            },
          };
          return builder;
        },
        async upsert(values: Record<string, unknown>, options?: { onConflict?: string }) {
          opts.upsertSpy?.(table, values, options);
          if (errorOn.has(table)) {
            return { error: { message: `simulated upsert error on ${table}` } };
          }
          return { error: null };
        },
      };
    },
  };
}

describe("createSupabaseCallAuthorizationRepo", () => {
  describe("isKillSwitchEngaged — the single most important inversion to get right", () => {
    it("is engaged (blocked) when the row is missing entirely (fresh migration, nothing inserted)", async () => {
      const repo = createSupabaseCallAuthorizationRepo(makeFakeClient({ tables: {} }));
      expect(await repo.isKillSwitchEngaged()).toBe(true);
    });

    it("is engaged (blocked) when enabled=false — the documented default row", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_kill_switch: [{ id: true, enabled: false }] } }),
      );
      expect(await repo.isKillSwitchEngaged()).toBe(true);
    });

    it("is NOT engaged only when enabled=true — the one explicit opt-in state", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_kill_switch: [{ id: true, enabled: true }] } }),
      );
      expect(await repo.isKillSwitchEngaged()).toBe(false);
    });

    it("fails closed (engaged) when the query errors", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_kill_switch: [{ id: true, enabled: true }] }, errorOn: ["call_kill_switch"] }),
      );
      expect(await repo.isKillSwitchEngaged()).toBe(true);
    });
  });

  describe("hasConsent", () => {
    it("is false when no consent row exists for the phone", async () => {
      const repo = createSupabaseCallAuthorizationRepo(makeFakeClient({ tables: { call_consent: [] } }));
      expect(await repo.hasConsent("+15551234567")).toBe(false);
    });

    it("is true only for the exact phone with a consent row", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_consent: [{ phone: "+15551234567" }] } }),
      );
      expect(await repo.hasConsent("+15551234567")).toBe(true);
      expect(await repo.hasConsent("+19998887777")).toBe(false);
    });

    it("fails closed (no consent) when the query errors", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_consent: [{ phone: "+15551234567" }] }, errorOn: ["call_consent"] }),
      );
      expect(await repo.hasConsent("+15551234567")).toBe(false);
    });
  });

  describe("getSpendCapCents", () => {
    it("is 0 when no row exists", async () => {
      const repo = createSupabaseCallAuthorizationRepo(makeFakeClient({ tables: { call_authorizations: [] } }));
      expect(await repo.getSpendCapCents("+15551234567")).toBe(0);
    });

    it("returns the configured cap for that phone", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_authorizations: [{ phone: "+15551234567", spend_cap_cents: 500 }] } }),
      );
      expect(await repo.getSpendCapCents("+15551234567")).toBe(500);
    });

    it("fails closed (zero budget) when the query errors", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({
          tables: { call_authorizations: [{ phone: "+15551234567", spend_cap_cents: 9999 }] },
          errorOn: ["call_authorizations"],
        }),
      );
      expect(await repo.getSpendCapCents("+15551234567")).toBe(0);
    });
  });

  describe("getAttemptsToday / recordAttempt", () => {
    it("is 0 when no attempts row exists today", async () => {
      const repo = createSupabaseCallAuthorizationRepo(makeFakeClient({ tables: { call_attempts: [] } }));
      expect(await repo.getAttemptsToday("+15551234567")).toBe(0);
    });

    it("fails closed (treated as over any limit) when the query errors", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_attempts: [] }, errorOn: ["call_attempts"] }),
      );
      expect(await repo.getAttemptsToday("+15551234567")).toBe(Number.POSITIVE_INFINITY);
    });

    it("recordAttempt upserts count+1 keyed on (phone, attempt_date)", async () => {
      const upsertSpy = vi.fn();
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_attempts: [] }, upsertSpy }),
      );
      await repo.recordAttempt("+15551234567");
      expect(upsertSpy).toHaveBeenCalledTimes(1);
      const [table, values, options] = upsertSpy.mock.calls[0];
      expect(table).toBe("call_attempts");
      expect(values.phone).toBe("+15551234567");
      expect(values.count).toBe(1);
      expect(options).toEqual({ onConflict: "phone,attempt_date" });
    });

    it("recordAttempt does not throw when the upsert errors (logs instead)", async () => {
      const repo = createSupabaseCallAuthorizationRepo(
        makeFakeClient({ tables: { call_attempts: [] }, errorOn: ["call_attempts"] }),
      );
      await expect(repo.recordAttempt("+15551234567")).resolves.toBeUndefined();
    });
  });
});
