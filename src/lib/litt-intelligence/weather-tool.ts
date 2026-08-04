/**
 * LiTT Weather Tool
 *
 * Combines user context, permission gate, and the Open-Meteo
 * weather provider into a single callable tool.
 *
 * Flow:
 *   1. Load user context (location, temperature unit)
 *   2. Check permission (weather.current capability + location set)
 *   3. Geocode city if needed
 *   4. Fetch weather from Open-Meteo
 *   5. Format result using user's temperature preference
 *   6. Audit log the call
 */

import "server-only";
import type { UserContext } from "./user-context";
import { formatTemperature } from "./user-context";
import { checkPermission, recordToolCall } from "./permission-gate";
import {
  geocodeCity,
  getCurrentWeather,
  getHourlyForecast,
  getDailyForecast,
  describeWeatherCode,
  type WeatherResult,
} from "./weather-provider";

export type WeatherToolResponse =
  | {
      success: true;
      data: WeatherResult;
      formatted: string;
    }
  | {
      success: false;
      error: string;
    };

export async function fetchWeatherForUser(
  ctx: UserContext,
  options?: { type?: "current" | "hourly" | "daily" },
): Promise<WeatherToolResponse> {
  const type = options?.type ?? "current";
  const capability = type === "current" ? "weather.current" : type === "hourly" ? "weather.hourly" : "weather.daily";

  const perm = checkPermission(ctx, capability);
  if (!perm.allowed) {
    return { success: false, error: perm.message };
  }

  let lat: number;
  let lon: number;
  let locationName: string;

  if (ctx.location.latitude != null && ctx.location.longitude != null) {
    lat = ctx.location.latitude;
    lon = ctx.location.longitude;
    locationName = ctx.location.city ?? `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  } else if (ctx.location.city) {
    const geo = await geocodeCity(ctx.location.city);
    if (geo.length === 0) {
      return {
        success: false,
        error: `Could not find coordinates for "${ctx.location.city}".`,
      };
    }
    lat = geo[0].latitude;
    lon = geo[0].longitude;
    locationName = geo[0].name;
  } else {
    return {
      success: false,
      error: "No location available. Set your city in Settings.",
    };
  }

  try {
    let result: WeatherResult;
    if (type === "hourly") {
      result = await getHourlyForecast(lat, lon);
    } else if (type === "daily") {
      result = await getDailyForecast(lat, lon);
    } else {
      result = await getCurrentWeather(lat, lon);
    }

    const formatted = formatWeatherResult(result, ctx, locationName);

    await recordToolCall(ctx.userId, {
      capabilityId: capability,
      provider: "open_meteo",
      action: `weather.${type}`,
      success: true,
      inputSummary: { lat, lon, locationName },
      outputSummary: {
        tempC: result.current.temperature,
        weatherCode: result.current.weatherCode,
      },
    });

    return { success: true, data: result, formatted };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Weather fetch failed";
    await recordToolCall(ctx.userId, {
      capabilityId: capability,
      provider: "open_meteo",
      action: `weather.${type}`,
      success: false,
      inputSummary: { lat, lon, locationName },
      outputSummary: { error: message },
    });
    return { success: false, error: message };
  }
}

function formatWeatherResult(
  result: WeatherResult,
  ctx: UserContext,
  locationName: string,
): string {
  const c = result.current;
  const desc = describeWeatherCode(c.weatherCode);
  const temp = formatTemperature(ctx, c.temperature);
  const feels = formatTemperature(ctx, c.apparentTemperature);

  let text = `Weather for ${locationName}:\n`;
  text += `${desc}, ${temp} (feels like ${feels})\n`;
  text += `Humidity: ${c.humidity}%, Wind: ${c.windSpeed} km/h`;

  if (result.hourly && result.hourly.length > 0) {
    const nextRain = result.hourly.find(
      (h) => h.precipitationProbability >= 50,
    );
    if (nextRain) {
      const rainTime = new Date(nextRain.time).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      text += `\nRain likely around ${rainTime} (${nextRain.precipitationProbability}% chance).`;
    }
  }

  if (result.daily && result.daily.length > 0) {
    const today = result.daily[0];
    const todayDesc = describeWeatherCode(today.weatherCode);
    text += `\nToday: ${todayDesc}, ${formatTemperature(ctx, today.tempMax)} / ${formatTemperature(ctx, today.tempMin)}`;
    if (today.precipitationProbabilityMax > 30) {
      text += `, ${today.precipitationProbabilityMax}% rain`;
    }
  }

  return text;
}
