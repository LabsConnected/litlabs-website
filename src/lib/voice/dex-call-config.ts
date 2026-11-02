/**
 * Dex outbound-calling number configuration (design-time constants, not
 * secrets). Owner decision 2026-10-22: reuse the existing Twilio toll-free
 * trial number as Dex's dedicated caller ID — no new number is purchased.
 */

// Existing Twilio toll-free trial number. Public business caller ID, not a
// credential — safe to keep as a plain constant, same treatment as the
// existing INWORLD_LITT_VOICE name elsewhere in this codebase.
export const DEX_TOLL_FREE_CALLER_ID = "+18772838063";

// Stays false until toll-free verification completes (owner requirement).
// Nothing in this codebase flips this automatically — it is a manual,
// reviewed change for Phase 2.
export const DEX_SMS_ENABLED = false;

// The owner's personal number is never hardcoded here or anywhere else in
// this feature. If/when call transfer is implemented (Phase 2), the target
// is read from this env var name at runtime, set directly in Railway by the
// owner — never ported, replaced, or otherwise modified by this system.
export const DEX_TRANSFER_TARGET_ENV_VAR = "DEX_TRANSFER_TARGET_NUMBER";
