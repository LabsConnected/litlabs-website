/**
 * LiTT Permission Gate
 *
 * Checks user consent and capability status before executing
 * any connector tool call. Enforces the principle that LiTT
 * must never access user data without explicit permission.
 *
 * If permission is missing, LiTT must fail honestly — never
 * invent data or silently bypass the check.
 */

import "server-only";
import type { CapabilityId } from "@/lib/connectors/provider-registry";
import {
  logConnectorAction,
  upsertCapability,
} from "@/lib/connectors/connector-repository";
import type { UserContext } from "./user-context";
import { hasLocation } from "./user-context";

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: PermissionDeniedReason; message: string };

export type PermissionDeniedReason =
  | "location_not_set"
  | "capability_disabled"
  | "needs_connection"
  | "needs_permission"
  | "unavailable"
  | "missing_context";

export function checkPermission(
  ctx: UserContext,
  capability: CapabilityId,
): PermissionResult {
  const status = ctx.capabilities[capability];

  if (status === "disabled") {
    return {
      allowed: false,
      reason: "capability_disabled",
      message: `The "${capability}" capability is disabled in your settings.`,
    };
  }

  if (status === "needs_connection") {
    return {
      allowed: false,
      reason: "needs_connection",
      message: `This requires a connected account. Connect it in Settings to enable "${capability}".`,
    };
  }

  if (status === "needs_permission") {
    return {
      allowed: false,
      reason: "needs_permission",
      message: `You have not granted permission for "${capability}". Enable it in Settings.`,
    };
  }

  if (status === "unavailable") {
    return {
      allowed: false,
      reason: "unavailable",
      message: `"${capability}" is not available right now.`,
    };
  }

  const locationCaps: CapabilityId[] = [
    "weather.current",
    "weather.hourly",
    "weather.daily",
  ];

  if (locationCaps.includes(capability) && !hasLocation(ctx)) {
    return {
      allowed: false,
      reason: "location_not_set",
      message:
        "I can check the weather, but I need your city or location permission first. Set it in Settings.",
    };
  }

  return { allowed: true };
}

export async function recordToolCall(
  userId: string,
  entry: {
    capabilityId: CapabilityId;
    provider: string;
    action: string;
    success: boolean;
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
  },
): Promise<void> {
  await logConnectorAction(userId, {
    capabilityId: entry.capabilityId,
    provider: entry.provider,
    action: entry.action,
    status: entry.success ? "success" : "failed",
    inputSummary: entry.inputSummary,
    outputSummary: entry.outputSummary,
  });
}

export async function grantCapability(
  userId: string,
  capability: CapabilityId,
  provider: string,
): Promise<boolean> {
  return upsertCapability(userId, capability, provider, "ready");
}

export async function revokeCapability(
  userId: string,
  capability: CapabilityId,
): Promise<boolean> {
  return upsertCapability(userId, capability, "user", "disabled");
}
