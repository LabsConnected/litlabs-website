import {
  type ActionEventPayload,
  type ActionEventType,
  type JsonValue,
} from "./types";

const SECRET_KEY = /(secret|password|passwd|token|cookie|authorization|api[_-]?key|private[_-]?key)/i;

function sanitizeValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
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
  return { message };
}
