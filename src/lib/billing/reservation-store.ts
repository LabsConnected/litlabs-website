// Reservation booking store — pure in-memory avector of the canonical
// reservation lifecycle decisions made by #684.
//
// This module is a documentation/contract module for the approved policy. The
// actual durable state lives in credit_reservations + agent_runs + the
// reserve_bits/settle_bits/release_bits RPCs. This file records the booking
// invariant we must preserve across retries, callbacks and worker restarts.

import type { BillabilityCause } from "./approved-rules";

// ── Reservation booking intent ───────────────────────────────────────

/**
 * What the caller wants to reserve before executing a run.
 */
export interface ReservationBooking {
  /** Internal user id (post Clerk resolution). */
  userId: string;
  /** Idempotency key scoped to this logical run. */
  idempotencyKey: string;
  /** Estimated BITS to hold. 0 for exempt/free runs that still need a row. */
  estimatedBits: number;
  /** Whether this is a plain Studio chat turn. */
  isPlainChat: boolean;
  /** Pre-resolved billability cause for the booking. */
  billabilityCause: BillabilityCause;
  /** Optional approval metadata for HOLD bookings. */
  approvalWait?: ApprovalWaitMetadata | null;
}

/**
 * Metadata for a reservation that is being held during an approval wait.
 */
export interface ApprovalWaitMetadata {
  /** Tool/gate id that is awaiting a decision. */
  gateId: string;
  /** ISO-8601 timestamp when the hold is scheduled to auto-release. */
  holdExpiresAt: string;
  /** Human-readable reason for the hold. */
  reason: string;
}

// ── Booking outcomes ─────────────────────────────────────────────────

/**
 * Outcome of attempting to book a reservation.
 */
export type BookingOutcome =
  | { ok: true; reservationId: string; mode: "RESERVED" | "HELD" | "NO_RESERVE"; reservedBits: number }
  | { ok: false; code: "ALREADY_BOOKED"; reservationId: string }
  | { ok: false; code: "INSUFFICIENT_BALANCE" }
  | { ok: false; code: "DB_UNAVAILABLE" }
  | { ok: false; code: "USER_NOT_FOUND" };

/**
 * Booking mode assigned by policy.
 *
 *  - RESERVED: hold estimatedBits against available balance (billable build).
 *  - HELD:    hold estimatedBits against available balance under approval timeout.
 *  - NO_RESERVE: no BITS held (exempt/free) but agent_runs row still created.
 */
export type BookingMode = "RESERVED" | "HELD" | "NO_RESERVE";
