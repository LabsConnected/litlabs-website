import { describe, it, expect } from "vitest";
import {
  classifyVoiceFailure,
  voiceFailureError,
  getVoiceFailureKind,
  VOICE_FAILURE_MESSAGES,
} from "./voice-failure";

/**
 * The failure-kind → message mapping behind the mobile voice fix.
 *
 * Larry's production report (Android Chrome): tapping the Studio mic
 * failed silently, or with a raw technical string. Every failure class
 * the mic path can hit must land on a plain-language message that names
 * the remedy — especially permission denial, whose recovery on Android
 * Chrome is the tune icon left of the address bar → Permissions →
 * Microphone → Allow (NOT a hunt through Chrome's settings menus).
 */

describe("classifyVoiceFailure — getUserMedia DOMExceptions", () => {
  it("NotAllowedError → permission_denied with the Android Chrome recovery steps", () => {
    const failure = classifyVoiceFailure(
      new DOMException("Permission denied", "NotAllowedError"),
    );
    expect(failure.kind).toBe("permission_denied");
    // The existing hook contract: the surfaced text names the denial.
    expect(failure.message).toContain("Microphone permission denied");
    // The actual recovery on Android Chrome — per-site permission UI.
    expect(failure.message).toMatch(/address bar/);
    expect(failure.message).toMatch(/Permissions/);
    expect(failure.message).toMatch(/Allow/);
    // Requirement: if a reload is genuinely needed, the message says so.
    expect(failure.message).toMatch(/reload the page/);
  });

  it("PermissionDeniedError (legacy name) → permission_denied", () => {
    const failure = classifyVoiceFailure(
      new DOMException("denied", "PermissionDeniedError"),
    );
    expect(failure.kind).toBe("permission_denied");
  });

  it("a bare message mentioning permission (Safari-style) → permission_denied", () => {
    const failure = classifyVoiceFailure(
      new Error("Microphone permission denied. Please allow microphone access in your browser settings."),
    );
    expect(failure.kind).toBe("permission_denied");
    // …and the message is upgraded to the actionable recovery steps.
    expect(failure.message).toMatch(/address bar/);
  });

  it("NotFoundError → no_microphone", () => {
    const failure = classifyVoiceFailure(
      new DOMException("Requested device not found", "NotFoundError"),
    );
    expect(failure.kind).toBe("no_microphone");
    expect(failure.message).toMatch(/No microphone found/);
  });

  it("NotReadableError (mic held by another app) → mic_busy", () => {
    const failure = classifyVoiceFailure(
      new DOMException("Could not start audio source", "NotReadableError"),
    );
    expect(failure.kind).toBe("mic_busy");
    expect(failure.message).toMatch(/busy/i);
    // The raw DOMException text must NOT be what the user reads.
    expect(failure.message).not.toMatch(/Could not start audio source/);
  });

  it("OverconstrainedError (stale stored device) → mic_unavailable", () => {
    const failure = classifyVoiceFailure(
      new DOMException("Overconstrained", "OverconstrainedError"),
    );
    expect(failure.kind).toBe("mic_unavailable");
  });
});

describe("classifyVoiceFailure — our own thrown transport errors", () => {
  it("connect timeout → connect_timeout with a check-your-connection remedy", () => {
    const failure = classifyVoiceFailure(
      new Error("Voice connection timed out. Please try again."),
    );
    expect(failure.kind).toBe("connect_timeout");
    expect(failure.message).toMatch(/connection/i);
  });

  it("connect failure → connect_failed", () => {
    const failure = classifyVoiceFailure(
      new Error("Voice connection failed. Please try again."),
    );
    expect(failure.kind).toBe("connect_failed");
  });

  it("audio context failure → audio_context, remedy is tap again (not a raw string)", () => {
    const failure = classifyVoiceFailure(
      new Error("Voice audio context could not start."),
    );
    expect(failure.kind).toBe("audio_context");
    expect(failure.message).toMatch(/tap the mic again/i);
    expect(failure.message).not.toMatch(/audio context/i);
  });

  it("the long self-diagnosing 4001 message keeps its text (kind auth)", () => {
    const diagnosis =
      "Voice can't connect: the website and the voice server (voice.example) are using " +
      "different credentials — the server rejected a freshly issued token. Fix: set the " +
      "same VOICE_AUTH_SECRET (32+ characters) on the web service and the voice-server " +
      "service in Railway, then redeploy both.";
    const failure = classifyVoiceFailure(new Error(diagnosis));
    expect(failure.kind).toBe("auth");
    expect(failure.message).toBe(diagnosis);
  });

  it("an unknown error → unknown kind with a plain snag message, never the raw text", () => {
    const failure = classifyVoiceFailure(new Error("xyzzy internal frobnicate 0x2f"));
    expect(failure.kind).toBe("unknown");
    expect(failure.message).toBe(VOICE_FAILURE_MESSAGES.unknown);
    expect(failure.message).not.toMatch(/frobnicate/);
  });

  it("a non-Error throw → unknown", () => {
    expect(classifyVoiceFailure("boom").kind).toBe("unknown");
    expect(classifyVoiceFailure(null).kind).toBe("unknown");
    expect(classifyVoiceFailure(undefined).kind).toBe("unknown");
  });
});

describe("voiceFailureError / getVoiceFailureKind — tagged errors round-trip", () => {
  it("a tagged permission error classifies back to permission_denied with the canonical message", () => {
    const err = voiceFailureError("permission_denied");
    expect(getVoiceFailureKind(err)).toBe("permission_denied");
    const failure = classifyVoiceFailure(err);
    expect(failure.kind).toBe("permission_denied");
    expect(failure.message).toBe(VOICE_FAILURE_MESSAGES.permission_denied);
  });

  it("an untagged error has no kind", () => {
    expect(getVoiceFailureKind(new Error("plain"))).toBeNull();
  });
});
