import {
  type ActionEventPayload,
  type ActionEventType,
  type ActionRunPatch,
  type JsonValue,
} from "./types";

const SECRET_KEY = /(secret|password|passwd|token|cookie|authorization|api[_-]?key|private[_-]?key)/i;

function sanitizeValue(value: unknown): JsonValue {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  // String values are free-form — a provider error under an innocent key
  // ({error: "Authorization: Bearer …"}) would otherwise persist raw secret
  // material. Apply the same conservative scrub as activity messages.
  if (typeof value === "string") {
    return sanitizeActionActivityMessage(value);
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY.test(key) ? "[REDACTED]" : sanitizeValue(nested);
    }
    return output;
  }
  return String(value);
}

export function sanitizeActionPayload(
  payload: Record<string, unknown> = {},
): ActionEventPayload {
  return sanitizeValue(payload) as ActionEventPayload;
}

const SECRET_VALUE_PATTERN = new RegExp(
  [
    String.raw`(?<key>(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|session[_-]?id|token|secret|password|passwd|credential|cookie|set-cookie|private[_-]?key)\s*(?:=|:)\s*(?:bearer\s+|basic\s+)?)(?<value>[^\s,;}"']+)`,
    String.raw`(?<key2>(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|session[_-]?id|token|secret|password|passwd|credential|cookie|set-cookie|private[_-]?key)\s+)(?<value2>[^\s,;}"']+)`,
    String.raw`Bearer\s+[A-Za-z0-9._~+\/-]+=*`,
    String.raw`Basic\s+[A-Za-z0-9._~+\/-]+=*`,
    String.raw`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
    String.raw`(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]+`,
  ].join("|"),
  "gi",
);

const HTML_DOCUMENT_PATTERN = /<!doctype\s+html|<html[\s>]|<body[\s>]|<script[\s>]/i;
const MAX_ACTIVITY_MESSAGE_LENGTH = 500;

/**
 * Sanitizes free-form text before it becomes durable product truth. This is
 * intentionally conservative: provider exceptions, HTTP dumps, credentials,
 * cookies, bearer material, and HTML bodies must never land in run/activity
 * fields where reconnecting clients and support tooling can read them.
 */
export function sanitizeActionActivityMessage(message: string | null | undefined): string | null {
  if (message === null || message === undefined) return null;
  let sanitized = String(message)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(SECRET_VALUE_PATTERN, (matched) => {
      const separator = matched.search(/[:=]/);
      return separator > 0 && !/^(Bearer|Basic)\s/i.test(matched)
        ? `${matched.slice(0, separator + 1)} [REDACTED]`
        : "[REDACTED]";
    })
    .replace(/<[a-z][^>]*>/gi, "[HTML_REDACTED]")
    .trim();
  if (HTML_DOCUMENT_PATTERN.test(message)) {
    sanitized = "[HTML response redacted]";
  }
  if (sanitized.length > MAX_ACTIVITY_MESSAGE_LENGTH) {
    sanitized = `${sanitized.slice(0, MAX_ACTIVITY_MESSAGE_LENGTH - 1).trimEnd()}…`;
  }
  return sanitized;
}

/** Sanitizes free-form ActionRun patch fields while leaving IDs/timestamps intact. */
export function sanitizeActionRunPatch(patch: ActionRunPatch = {}): ActionRunPatch {
  const sanitized = { ...patch };
  if (typeof sanitized.currentActivity === "string") {
    sanitized.currentActivity = sanitizeActionActivityMessage(sanitized.currentActivity);
  }
  if (typeof sanitized.failureMessage === "string") {
    sanitized.failureMessage = sanitizeActionActivityMessage(sanitized.failureMessage);
  }
  if (typeof sanitized.approvalReference === "string") {
    sanitized.approvalReference = sanitizeActionActivityMessage(sanitized.approvalReference);
  }
  return sanitized;
}

export interface ActionEventInput {
  runId: string;
  userId: string;
  type: ActionEventType;
  payload?: Record<string, unknown>;
}

export interface ActivityEventInput extends ActionEventInput {
  type: "activity.created";
  message: string;
}

export function activityPayload(message: string): Record<string, unknown> {
  return { message: sanitizeActionActivityMessage(message) };
}
