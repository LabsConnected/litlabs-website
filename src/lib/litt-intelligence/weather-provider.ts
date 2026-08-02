/**
 * LiTT Weather Tool — Open-Meteo Provider
 *
 * Fetches real weather data from the Open-Meteo API.
 * No API key required for non-commercial use.
 *
 * Capabilities:
 *   - weather.current: current temperature, conditions, wind, humidity
 *   - weather.hourly:  hourly forecast (next 24h)
 *   - weather.daily:   daily forecast (next 7 days)
 *   - weather.geocode: city name -> lat/lon lookup
 */

import "server-only";

const OPEN_METEO_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export interface GeoLocation {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1: string | null;
  timezone: string | null;
}

export interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  isDay: boolean;
  time: string;
}

export interface HourlyForecast {
  time: string;
  temperature: number;
  precipitationProbability: number;
  weatherCode: number;
  windSpeed: number;
}

export interface DailyForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  precipitationSum: number;
  precipitationProbabilityMax: number;
  windSpeedMax: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherResult {
  location: GeoLocation;
  current: CurrentWeather;
  hourly?: HourlyForecast[];
  daily?: DailyForecast[];
  fetchedAt: number;
}

export async function geocodeCity(
  city: string,
  count = 1,
): Promise<GeoLocation[]> {
  const url = `${OPEN_METEO_GEOCODE_URL}?name=${encodeURIComponent(city)}&count=${count}&language=en&format=json`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Geocode failed: ${resp.status}`);
  }
  const data = (await resp.json()) as {
    results?: Array<{
      name: string;
      latitude: number;
      longitude: number;
      country: string;
      admin1?: string | null;
      timezone?: string | null;
    }>;
  };
  if (!data.results || data.results.length === 0) {
    return [];
  }
  return data.results.map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    admin1: r.admin1 ?? null,
    timezone: r.timezone ?? null,
  }));
}

export async function getCurrentWeather(
  latitude: number,
  longitude: number,
): Promise<WeatherResult> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "wind_speed_10m",
      "wind_direction_10m",
      "weather_code",
      "is_day",
    ].join(","),
    timezone: "auto",
    forecast_days: "1",
  });

  const url = `${OPEN_METEO_FORECAST_URL}?${params}`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Weather fetch failed: ${resp.status}`);
  }
  const data = (await resp.json()) as {
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
      weather_code: number;
      is_day: number;
    };
  };

  return {
    location: {
      name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      latitude,
      longitude,
      country: "",
      admin1: null,
      timezone: null,
    },
    current: {
      temperature: data.current.temperature_2m,
      apparentTemperature: data.current.apparent_temperature,
      humidity: data.current.relative_humidity_2m,
      windSpeed: data.current.wind_speed_10m,
      windDirection: data.current.wind_direction_10m,
      weatherCode: data.current.weather_code,
      isDay: data.current.is_day === 1,
      time: data.current.time,
    },
    fetchedAt: Date.now(),
  };
}

export async function getHourlyForecast(
  latitude: number,
  longitude: number,
  hours = 24,
): Promise<WeatherResult> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: [
      "temperature_2m",
      "precipitation_probability",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
    timezone: "auto",
    forecast_days: "2",
  });

  const url = `${OPEN_METEO_FORECAST_URL}?${params}`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Hourly forecast failed: ${resp.status}`);
  }
  const data = (await resp.json()) as {
    hourly: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability: number[];
      weather_code: number[];
      wind_speed_10m: number[];
    };
  };

  const now = Date.now();
  const hourly: HourlyForecast[] = [];
  for (let i = 0; i < data.hourly.time.length && hourly.length < hours; i++) {
    const t = new Date(data.hourly.time[i]).getTime();
    if (t < now - 3600_000) continue;
    hourly.push({
      time: data.hourly.time[i],
      temperature: data.hourly.temperature_2m[i],
      precipitationProbability: data.hourly.precipitation_probability[i] ?? 0,
      weatherCode: data.hourly.weather_code[i],
      windSpeed: data.hourly.wind_speed_10m[i],
    });
  }

  return {
    location: {
      name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      latitude,
      longitude,
      country: "",
      admin1: null,
      timezone: null,
    },
    current: {
      temperature: hourly[0]?.temperature ?? 0,
      apparentTemperature: hourly[0]?.temperature ?? 0,
      humidity: 0,
      windSpeed: hourly[0]?.windSpeed ?? 0,
      windDirection: 0,
      weatherCode: hourly[0]?.weatherCode ?? 0,
      isDay: true,
      time: hourly[0]?.time ?? new Date().toISOString(),
    },
    hourly,
    fetchedAt: Date.now(),
  };
}

export async function getDailyForecast(
  latitude: number,
  longitude: number,
  days = 7,
): Promise<WeatherResult> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "sunrise",
      "sunset",
    ].join(","),
    timezone: "auto",
    forecast_days: String(Math.min(days, 16)),
  });

  const url = `${OPEN_METEO_FORECAST_URL}?${params}`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`Daily forecast failed: ${resp.status}`);
  }
  const data = (await resp.json()) as {
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
      precipitation_probability_max: number[];
      wind_speed_10m_max: number[];
      sunrise: string[];
      sunset: string[];
    };
  };

  const daily: DailyForecast[] = data.daily.time.map((date, i) => ({
    date,
    tempMax: data.daily.temperature_2m_max[i],
    tempMin: data.daily.temperature_2m_min[i],
    weatherCode: data.daily.weather_code[i],
    precipitationSum: data.daily.precipitation_sum[i] ?? 0,
    precipitationProbabilityMax:
      data.daily.precipitation_probability_max[i] ?? 0,
    windSpeedMax: data.daily.wind_speed_10m_max[i],
    sunrise: data.daily.sunrise[i],
    sunset: data.daily.sunset[i],
  }));

  return {
    location: {
      name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      latitude,
      longitude,
      country: "",
      admin1: null,
      timezone: null,
    },
    current: {
      temperature: daily[0]?.tempMax ?? 0,
      apparentTemperature: daily[0]?.tempMax ?? 0,
      humidity: 0,
      windSpeed: daily[0]?.windSpeedMax ?? 0,
      windDirection: 0,
      weatherCode: daily[0]?.weatherCode ?? 0,
      isDay: true,
      time: daily[0]?.date ?? new Date().toISOString(),
    },
    daily,
    fetchedAt: Date.now(),
  };
}

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export function describeWeatherCode(code: number): string {
  return WMO_DESCRIPTIONS[code] ?? "Unknown";
}
