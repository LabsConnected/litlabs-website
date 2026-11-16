/**
 * LiTT Places Tool
 *
 * Combines user context, permission gate, and the Google Places
 * provider into a single callable tool — mirrors the weather-tool
 * pattern.
 */

import "server-only";
import type { UserContext } from "./user-context";
import { checkPermission, recordToolCall } from "./permission-gate";
import {
  searchPlace,
  formatPlaceResult,
  isPlacesAvailable,
  type PlaceHours,
} from "./places-provider";

export type PlacesToolResponse =
  | {
      success: true;
      data: PlaceHours;
      formatted: string;
    }
  | {
      success: false;
      error: string;
    };

export async function executePlacesLookup(
  ctx: UserContext,
  query: string,
): Promise<PlacesToolResponse> {
  const perm = checkPermission(ctx, "places.search");
  if (!perm.allowed) {
    return { success: false, error: perm.message };
  }

  if (!isPlacesAvailable()) {
    return {
      success: false,
      error:
        "I don't have a configured place lookup right now. Set GOOGLE_PLACES_API_KEY to enable business hours lookups.",
    };
  }

  try {
    const place = await searchPlace(query);
    if (!place) {
      await recordToolCall(ctx.userId, {
        capabilityId: "places.search",
        provider: "google_places",
        action: "places.search",
        success: false,
        inputSummary: { query },
        outputSummary: { found: false },
      });
      return { success: false, error: `I couldn't find a match for "${query}".` };
    }

    const formatted = formatPlaceResult(place);

    await recordToolCall(ctx.userId, {
      capabilityId: "places.search",
      provider: "google_places",
      action: "places.search",
      success: true,
      inputSummary: { query },
      outputSummary: { name: place.name, openNow: place.openNow },
    });

    return { success: true, data: place, formatted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Places lookup failed";
    await recordToolCall(ctx.userId, {
      capabilityId: "places.search",
      provider: "google_places",
      action: "places.search",
      success: false,
      inputSummary: { query },
      outputSummary: { error: message },
    });
    return { success: false, error: `I couldn't complete that lookup: ${message}` };
  }
}
