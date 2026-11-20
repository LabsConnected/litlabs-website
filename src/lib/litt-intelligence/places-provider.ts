/**
 * LiTT Places Tool — Google Places Provider
 *
 * Resolves business/place hours and address via the Google Places API
 * (Text Search + Place Details). Requires GOOGLE_PLACES_API_KEY.
 *
 * Capability: places.search
 */

import "server-only";

const PLACES_TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const PLACES_DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";

export interface PlaceHours {
  name: string;
  address: string;
  openNow: boolean | null;
  weekdayText: string[];
  mapsUrl: string | null;
}

// Google returns HTTP 200 with these body statuses for key/quota/request
// failures. They are NOT "no match", so they must throw instead of null.
const PLACES_ERROR_STATUSES = new Set([
  "REQUEST_DENIED",
  "OVER_QUERY_LIMIT",
  "INVALID_REQUEST",
  "UNKNOWN_ERROR",
]);

function getApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

export function isPlacesAvailable(): boolean {
  return getApiKey() !== null;
}

export async function searchPlace(query: string): Promise<PlaceHours | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Places lookup is not configured. Set GOOGLE_PLACES_API_KEY.");
  }

  const searchParams = new URLSearchParams({ query, key: apiKey });
  const searchResp = await fetch(`${PLACES_TEXTSEARCH_URL}?${searchParams}`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!searchResp.ok) {
    throw new Error(`Places search failed: ${searchResp.status}`);
  }

  const searchData = (await searchResp.json()) as {
    status: string;
    results?: Array<{ place_id: string; name: string; formatted_address: string }>;
  };
  if (PLACES_ERROR_STATUSES.has(searchData.status)) {
    throw new Error(`Places search failed: ${searchData.status}`);
  }
  if (searchData.status !== "OK" || !searchData.results || searchData.results.length === 0) {
    return null;
  }

  const top = searchData.results[0];
  const detailsParams = new URLSearchParams({
    place_id: top.place_id,
    fields: "name,formatted_address,opening_hours,url",
    key: apiKey,
  });
  const detailsResp = await fetch(`${PLACES_DETAILS_URL}?${detailsParams}`, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!detailsResp.ok) {
    throw new Error(`Place details failed: ${detailsResp.status}`);
  }

  const detailsData = (await detailsResp.json()) as {
    status: string;
    result?: {
      name: string;
      formatted_address: string;
      opening_hours?: { open_now?: boolean; weekday_text?: string[] };
      url?: string;
    };
  };
  if (PLACES_ERROR_STATUSES.has(detailsData.status)) {
    throw new Error(`Place details failed: ${detailsData.status}`);
  }
  if (detailsData.status !== "OK" || !detailsData.result) {
    return null;
  }

  const r = detailsData.result;
  return {
    name: r.name,
    address: r.formatted_address,
    openNow: r.opening_hours?.open_now ?? null,
    weekdayText: r.opening_hours?.weekday_text ?? [],
    mapsUrl: r.url ?? null,
  };
}

export function formatPlaceResult(place: PlaceHours): string {
  const status =
    place.openNow === true ? "open now" : place.openNow === false ? "closed now" : "hours unknown";
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const todayLine = place.weekdayText.find((line) => line.startsWith(todayName));

  let text = `${place.name} (${place.address}) is ${status}.`;
  if (todayLine) {
    text += ` Today: ${todayLine.replace(`${todayName}: `, "")}.`;
  }
  text += place.mapsUrl ? ` Source: Google Places (${place.mapsUrl}).` : " Source: Google Places.";
  return text;
}
