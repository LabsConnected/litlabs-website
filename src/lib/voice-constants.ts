/**
 * LiTT's signature Inworld voice: "LiT-Code".
 *
 * This is the built-in default used whenever INWORLD_LITT_VOICE is not set.
 * The ID is not a secret — the token endpoint already returns the resolved
 * voice ID to every authenticated client. Keeping the signature voice as a
 * code-level default prevents a missing env var from silently disabling the
 * Inworld voice path (observed 2026-10-27: the var was unset on every
 * deployed web environment).
 */
export const LIT_CODE_VOICE_ID =
  "rustic-banana-5826__design-voice-e5899468";
