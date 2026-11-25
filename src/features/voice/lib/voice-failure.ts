/**
 * Voice failure classification — the single place where a raw voice-path
 * error (a getUserMedia DOMException, a transport throw, an audio-context
 * failure) becomes a typed failure kind plus the plain-language message
 * the user actually reads at the composer.
 *
 * Why this exists: the mic path used to surface whatever the lowest layer
 * threw — raw DOMException text ("Could not start audio source"), a
 * generic "Voice unavailable", or nothing at all — and it funnelled every
 * failure into one generic state, so the purpose-built permission_denied
 * and unsupported states in the session machine were unreachable. On a
 * phone there is no hover tooltip to rescue a vague message: the text at
 * the composer is the whole UX. Every kind below names the remedy.
 *
 * Android Chrome notes (the platform Larry reported from):
 *  - A blocked site permission makes getUserMedia reject IMMEDIATELY
 *    with NotAllowedError — no prompt appears. The recovery is the tune
 *    icon to the left of the address bar → Permissions → Microphone →
 *    Allow; "browser settings" sends users hunting through the wrong
 *    menus. After the user grants it, the next getUserMedia call succeeds
 *    with no reload in the common case — the message still names the
 *    reload fallback for the case where Chrome keeps the old decision.
 *  - Another app holding the mic (a call, another recorder) surfaces as
 *    NotReadableError, and a persisted input device that has since been
 *    unplugged surfaces as OverconstrainedError against the stored
 *    { exact: deviceId } constraint.
 */

export type VoiceFailureKind =
  | "permission_denied"
  | "no_microphone"
  | "mic_busy"
  | "mic_unavailable"
  | "unsupported"
  | "audio_context"
  | "connect_timeout"
  | "connect_failed"
  | "auth"
  | "session"
  | "unknown";

export interface VoiceFailure {
  kind: VoiceFailureKind;
  message: string;
}

export const VOICE_FAILURE_MESSAGES: Record<VoiceFailureKind, string> = {
  permission_denied:
    "Microphone permission denied — the microphone is blocked for this site. " +
    "Tap the icon to the left of the address bar, choose Permissions, and set " +
    "Microphone to Allow. Then tap the mic again — if it still won't start, reload the page.",
  no_microphone:
    "No microphone found. Check that one is connected and not disabled, then tap the mic and try again.",
  mic_busy:
    "The microphone is busy — another app may be using it. Close that app, then tap the mic and try again.",
  mic_unavailable:
    "That microphone isn't available anymore. Tap the mic to try again with the default microphone.",
  unsupported:
    "Voice input isn't supported in this browser. Try the latest version of Chrome, Edge, or Firefox.",
  audio_context:
    "Audio couldn't start on that tap. Tap the mic again — it usually works the second time.",
  connect_timeout:
    "The voice service took too long to answer. Check your connection, then tap the mic to try again.",
  connect_failed:
    "The voice service couldn't be reached. Check your connection, then tap the mic to try again.",
  auth: "Voice sign-in failed. Please try again — if it keeps failing, sign out and back in.",
  session: "The voice session hit a snag. Tap the mic to try again.",
  unknown: "Voice hit a snag. Tap the mic to try again.",
};

/**
 * Long messages are deliberate self-diagnoses (the double-4001 credential
 * diagnosis names its own fix) — classification may tag their kind but
 * must not replace their text with a generic line.
 */
const DIAGNOSTIC_MESSAGE_MIN_LENGTH = 140;

interface TaggedVoiceError extends Error {
  voiceFailureKind?: VoiceFailureKind;
}

/** Create an Error carrying its failure kind for upstream classifiers. */
export function voiceFailureError(
  kind: VoiceFailureKind,
  message: string = VOICE_FAILURE_MESSAGES[kind],
): Error {
  const err = new Error(message) as TaggedVoiceError;
  err.voiceFailureKind = kind;
  return err;
}

/** Read the failure kind a lower layer tagged onto an error, if any. */
export function getVoiceFailureKind(err: unknown): VoiceFailureKind | null {
  if (err !== null && typeof err === "object") {
    const kind = (err as TaggedVoiceError).voiceFailureKind;
    if (typeof kind === "string" && kind in VOICE_FAILURE_MESSAGES) {
      return kind as VoiceFailureKind;
    }
  }
  return null;
}

const DOM_EXCEPTION_KINDS: Record<string, VoiceFailureKind> = {
  NotAllowedError: "permission_denied",
  PermissionDeniedError: "permission_denied",
  NotFoundError: "no_microphone",
  DevicesNotFoundError: "no_microphone",
  NotReadableError: "mic_busy",
  TrackStartError: "mic_busy",
  AbortError: "mic_busy",
  OverconstrainedError: "mic_unavailable",
  ConstraintNotSatisfiedError: "mic_unavailable",
  SecurityError: "unsupported",
};

function kindFromMessage(message: string): VoiceFailureKind | null {
  if (/permission|notallowed/i.test(message)) return "permission_denied";
  if (/notfound|no microphone/i.test(message)) return "no_microphone";
  if (/timed out|timeout/i.test(message)) return "connect_timeout";
  if (/audio context/i.test(message)) return "audio_context";
  if (/authentication|sign in again|4001|credential/i.test(message)) return "auth";
  if (/not configured|not active|session/i.test(message)) return "session";
  if (/connection|connect|network|reach/i.test(message)) return "connect_failed";
  return null;
}

/**
 * Classify any error the voice path can throw into a failure kind and
 * the message the user should read. Short raw messages are replaced by
 * the canonical plain-language text; long diagnostic messages keep their
 * own text (see DIAGNOSTIC_MESSAGE_MIN_LENGTH).
 */
export function classifyVoiceFailure(err: unknown): VoiceFailure {
  const tagged = getVoiceFailureKind(err);
  const rawMessage = err instanceof Error ? err.message : "";

  if (tagged) {
    return { kind: tagged, message: rawMessage || VOICE_FAILURE_MESSAGES[tagged] };
  }

  let kind: VoiceFailureKind | null = null;
  if (err instanceof DOMException && err.name in DOM_EXCEPTION_KINDS) {
    kind = DOM_EXCEPTION_KINDS[err.name];
  }
  if (!kind && rawMessage) {
    kind = kindFromMessage(rawMessage);
  }
  if (!kind) {
    return { kind: "unknown", message: VOICE_FAILURE_MESSAGES.unknown };
  }

  if (rawMessage.length > DIAGNOSTIC_MESSAGE_MIN_LENGTH) {
    return { kind, message: rawMessage };
  }
  return { kind, message: VOICE_FAILURE_MESSAGES[kind] };
}
