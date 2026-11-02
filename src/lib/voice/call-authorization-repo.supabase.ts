import type { CallAuthorizationRepo } from "./call-authorization";

/**
 * Minimal structural subset of the Supabase client's query-builder chain
 * that this repo needs. The real `@supabase/supabase-js` client satisfies
 * this shape, so `createSupabaseCallAuthorizationRepo(supabaseAdmin)` works
 * unchanged — but tests can pass a lightweight fake with no network layer.
 */
export interface SupabaseFilterBuilder {
  eq(column: string, value: unknown): SupabaseFilterBuilder;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
}

export interface SupabaseLike {
  from(table: string): {
    select(columns: string): SupabaseFilterBuilder;
    upsert(
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ): Promise<{ error: { message: string } | null }>;
  };
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Supabase-backed CallAuthorizationRepo. Every method fails closed: a query
 * error or missing row is treated as the most restrictive answer (engaged /
 * no consent / zero budget), never as "allow". This mirrors the hard-coded
 * Phase 1 repo's safety property while reading real data once wired in.
 *
 * recordAttempt() is a read-then-upsert, not a single atomic increment —
 * acceptable for a single-owner, 1-attempt/day limit with effectively no
 * concurrent writers, but it is not safe to reuse as-is for a high-concurrency
 * counter. Noted here rather than silently assumed correct.
 */
export function createSupabaseCallAuthorizationRepo(client: SupabaseLike): CallAuthorizationRepo {
  return {
    async isKillSwitchEngaged(): Promise<boolean> {
      const { data, error } = await client
        .from("call_kill_switch")
        .select("enabled")
        .eq("id", true)
        .maybeSingle();
      if (error || !data) return true; // fail closed: unreadable => engaged => blocked
      return data.enabled !== true;
    },

    async hasConsent(phone: string): Promise<boolean> {
      const { data, error } = await client
        .from("call_consent")
        .select("phone")
        .eq("phone", phone)
        .maybeSingle();
      if (error) return false; // fail closed: unreadable => no consent
      return !!data;
    },

    async getSpendCapCents(phone: string): Promise<number> {
      const { data, error } = await client
        .from("call_authorizations")
        .select("spend_cap_cents")
        .eq("phone", phone)
        .maybeSingle();
      if (error || !data) return 0; // fail closed: unreadable => zero budget
      const cap = data.spend_cap_cents;
      return typeof cap === "number" ? cap : 0;
    },

    async getAttemptsToday(phone: string): Promise<number> {
      const { data, error } = await client
        .from("call_attempts")
        .select("count")
        .eq("phone", phone)
        .eq("attempt_date", todayDateString())
        .maybeSingle();
      if (error) return Number.POSITIVE_INFINITY; // fail closed: unreadable => over any limit
      const count = data?.count;
      return typeof count === "number" ? count : 0;
    },

    async recordAttempt(phone: string): Promise<void> {
      const current = await this.getAttemptsToday(phone);
      const safeCurrent = Number.isFinite(current) ? current : 0;
      const { error } = await client
        .from("call_attempts")
        .upsert(
          { phone, attempt_date: todayDateString(), count: safeCurrent + 1 },
          { onConflict: "phone,attempt_date" },
        );
      if (error) {
        // Best-effort counter: failing to record must not throw and must
        // not be treated as a reason to retroactively deny an already-
        // authorized call. Surfaced via console.error for operator visibility.
        console.error("[call-authorization] failed to record attempt:", error.message);
      }
    },
  };
}
