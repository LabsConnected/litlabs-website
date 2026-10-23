/**
 * Expired-reservation sweep entry point.
 *
 * Scheduler: the same shape as /api/billing/sweep-media-holds (a route
 * Vercel cron can GET, plus an optional pg_cron function). This sweep is
 * code-only. BILLING_RESERVATION_SWEEP_ENABLED is not set, vercel.json
 * does not list the path, and the migration does not call cron.schedule.
 *
 * The database function is the atomic claim (FOR UPDATE SKIP LOCKED, then
 * settle_bits / release_bits). This module only decides whether to call it.
 */

export function reservationSweepEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLING_RESERVATION_SWEEP_ENABLED === "1";
}

export interface ReservationSweepCounts {
  enabled: true;
  settled: number;
  released: number;
  expired: number;
  skipped: number;
}

export async function runReservationSweep(
  db: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> } | null,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<{ enabled: false } | ReservationSweepCounts> {
  if (!reservationSweepEnabled(env)) return { enabled: false };
  if (!db) throw new Error("reservation sweep database unavailable");
  const { data, error } = await db.rpc("sweep_expired_reservations", { p_now: now.toISOString() });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as {
    settled?: number;
    released?: number;
    expired?: number;
    skipped?: number;
  } | null;
  return {
    enabled: true,
    settled: Number(row?.settled ?? 0),
    released: Number(row?.released ?? 0),
    expired: Number(row?.expired ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
}
