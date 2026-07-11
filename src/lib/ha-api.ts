/**
 * Home Assistant API Bridge
 * Universal HA client for LiTT Code LabStudios agents to interact with smart home devices.
 *
 * When running inside HA Supervisor:
 *   - Reads SUPERVISOR_TOKEN from env
 *   - Uses http://supervisor/core/api/ for REST
 *   - Uses ws://supervisor/core/websocket for WebSocket
 *
 * When running standalone (Vercel / dev):
 *   - Gracefully degrades to mock data
 */

/* ------------------------------------------------------------------ */
/*  Environment & Config                                                */
/* ------------------------------------------------------------------ */
const HA_ADDON_MODE = process.env.HA_ADDON_MODE === "true";
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || process.env.HA_SUPERVISOR_TOKEN || "";
const HA_API_BASE = process.env.HA_API_URL || "http://supervisor/core/api";
const HA_WS_BASE = process.env.HA_WS_URL || "ws://supervisor/core/websocket";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: { id: string; parent_id: string | null; user_id: string | null };
}

export interface HAServiceResponse {
  success: boolean;
  message?: string;
  result?: unknown;
}

export interface HADeviceMap {
  lights: HAEntity[];
  switches: HAEntity[];
  sensors: HAEntity[];
  climate: HAEntity[];
  media_players: HAEntity[];
  all: HAEntity[];
  areas: Record<string, HAEntity[]>;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */
async function haFetch(path: string, init?: RequestInit): Promise<unknown> {
  if (!HA_ADDON_MODE || !SUPERVISOR_TOKEN) {
    throw new Error("HA Supervisor not available — running in standalone mode");
  }
  const url = `${HA_API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${SUPERVISOR_TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HA API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function mockEntity(domain: string, id: string, state: string, attrs: Record<string, unknown> = {}): HAEntity {
  return {
    entity_id: `${domain}.${id}`,
    state,
    attributes: attrs,
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: "mock", parent_id: null, user_id: null },
  };
}

function getMockDevices(): HADeviceMap {
  return {
    lights: [
      mockEntity("light", "living_room", "on", { brightness: 180, friendly_name: "Living Room Light", supported_color_modes: ["brightness", "color_temp"] }),
      mockEntity("light", "bedroom", "off", { friendly_name: "Bedroom Light", supported_color_modes: ["brightness"] }),
      mockEntity("light", "kitchen", "on", { brightness: 255, rgb_color: [255, 100, 50], friendly_name: "Kitchen Light" }),
    ],
    switches: [
      mockEntity("switch", "coffee_maker", "off", { friendly_name: "Coffee Maker" }),
      mockEntity("switch", "fan", "on", { friendly_name: "Ceiling Fan" }),
    ],
    sensors: [
      mockEntity("sensor", "living_room_temp", "22.5", { unit_of_measurement: "°C", friendly_name: "Living Room Temperature" }),
      mockEntity("sensor", "outside_humidity", "65", { unit_of_measurement: "%", friendly_name: "Outside Humidity" }),
      mockEntity("binary_sensor", "front_door", "off", { friendly_name: "Front Door", device_class: "door" }),
    ],
    climate: [
      mockEntity("climate", "thermostat", "heat", { temperature: 22, current_temperature: 21.5, hvac_modes: ["off", "heat", "cool", "auto"], friendly_name: "Thermostat" }),
    ],
    media_players: [
      mockEntity("media_player", "living_room_speaker", "idle", { friendly_name: "Living Room Speaker", volume_level: 0.4 }),
    ],
    all: [],
    areas: {
      living_room: [
        mockEntity("light", "living_room", "on", { brightness: 180, friendly_name: "Living Room Light" }),
        mockEntity("media_player", "living_room_speaker", "idle", { friendly_name: "Living Room Speaker" }),
      ],
      bedroom: [
        mockEntity("light", "bedroom", "off", { friendly_name: "Bedroom Light" }),
        mockEntity("climate", "thermostat", "heat", { temperature: 22, current_temperature: 21.5, friendly_name: "Thermostat" }),
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/*  REST API Methods                                                   */
/* ------------------------------------------------------------------ */

/** Get all entity states */
export async function getStates(): Promise<HAEntity[]> {
  try {
    return (await haFetch("/states")) as HAEntity[];
  } catch {
    return getMockDevices().all.concat(
      getMockDevices().lights,
      getMockDevices().switches,
      getMockDevices().sensors,
      getMockDevices().climate,
      getMockDevices().media_players
    );
  }
}

/** Get a single entity state */
export async function getState(entityId: string): Promise<HAEntity | null> {
  try {
    return (await haFetch(`/states/${entityId}`)) as HAEntity;
  } catch {
    const all = await getStates();
    return all.find((e) => e.entity_id === entityId) || null;
  }
}

/** Call any HA service */
export async function callService(
  domain: string,
  service: string,
  data: Record<string, unknown> = {}
): Promise<HAServiceResponse> {
  try {
    await haFetch(`/services/${domain}/${service}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { success: true, message: `Called ${domain}.${service}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}

/** Get HA configuration */
export async function getConfig(): Promise<unknown> {
  try {
    return await haFetch("/config");
  } catch {
    return { version: "mock", location_name: "Mock Home" };
  }
}

/* ------------------------------------------------------------------ */
/*  Entity helpers (typed by domain)                                   */
/* ------------------------------------------------------------------ */

export async function getLights(): Promise<HAEntity[]> {
  const states = await getStates();
  return states.filter((e) => e.entity_id.startsWith("light."));
}

export async function getSensors(): Promise<HAEntity[]> {
  const states = await getStates();
  return states.filter(
    (e) => e.entity_id.startsWith("sensor.") || e.entity_id.startsWith("binary_sensor.")
  );
}

export async function getClimate(): Promise<HAEntity[]> {
  const states = await getStates();
  return states.filter((e) => e.entity_id.startsWith("climate."));
}

export async function getMediaPlayers(): Promise<HAEntity[]> {
  const states = await getStates();
  return states.filter((e) => e.entity_id.startsWith("media_player."));
}

export async function getSwitches(): Promise<HAEntity[]> {
  const states = await getStates();
  return states.filter(
    (e) => e.entity_id.startsWith("switch.") || e.entity_id.startsWith("input_boolean.")
  );
}

export async function getHistory(entityId: string, hours = 24): Promise<unknown> {
  try {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return await haFetch(`/history/period/${start}?filter_entity_id=${entityId}&end_time=${end}`);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Convenience actions                                                */
/* ------------------------------------------------------------------ */

export async function turnOn(entityId: string): Promise<HAServiceResponse> {
  const [domain] = entityId.split(".");
  return callService(domain, "turn_on", { entity_id: entityId });
}

export async function turnOff(entityId: string): Promise<HAServiceResponse> {
  const [domain] = entityId.split(".");
  return callService(domain, "turn_off", { entity_id: entityId });
}

export async function toggle(entityId: string): Promise<HAServiceResponse> {
  const [domain] = entityId.split(".");
  return callService(domain, "toggle", { entity_id: entityId });
}

export async function setBrightness(entityId: string, pct: number): Promise<HAServiceResponse> {
  const brightness = Math.max(0, Math.min(255, Math.round((pct / 100) * 255)));
  return callService("light", "turn_on", { entity_id: entityId, brightness });
}

export async function setColor(entityId: string, hex: string): Promise<HAServiceResponse> {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return callService("light", "turn_on", { entity_id: entityId, rgb_color: [r, g, b] });
}

export async function setTemperature(entityId: string, temp: number): Promise<HAServiceResponse> {
  return callService("climate", "set_temperature", { entity_id: entityId, temperature: temp });
}

export async function mediaPlay(entityId: string): Promise<HAServiceResponse> {
  return callService("media_player", "media_play", { entity_id: entityId });
}

export async function mediaPause(entityId: string): Promise<HAServiceResponse> {
  return callService("media_player", "media_pause", { entity_id: entityId });
}

export async function playMedia(entityId: string, url: string): Promise<HAServiceResponse> {
  return callService("media_player", "play_media", { entity_id: entityId, media_content_id: url, media_content_type: "audio/mp3" });
}

export async function notify(message: string, title = "LiTT Code LabStudios", target?: string): Promise<HAServiceResponse> {
  return callService("notify", target || "persistent_notification", { message, title });
}

export async function tts(message: string, entityId?: string): Promise<HAServiceResponse> {
  if (entityId) {
    return callService("tts", "speak", { message, entity_id: entityId });
  }
  return callService("tts", "speak", { message });
}

/* ------------------------------------------------------------------ */
/*  Auto-discovery (build device map)                                  */
/* ------------------------------------------------------------------ */
export async function getDeviceMap(): Promise<HADeviceMap> {
  try {
    const all = await getStates();
    const lights = all.filter((e) => e.entity_id.startsWith("light."));
    const switches = all.filter((e) => e.entity_id.startsWith("switch.") || e.entity_id.startsWith("input_boolean."));
    const sensors = all.filter((e) => e.entity_id.startsWith("sensor.") || e.entity_id.startsWith("binary_sensor."));
    const climate = all.filter((e) => e.entity_id.startsWith("climate."));
    const media_players = all.filter((e) => e.entity_id.startsWith("media_player."));
    return { lights, switches, sensors, climate, media_players, all, areas: {} };
  } catch {
    return getMockDevices();
  }
}

/* ------------------------------------------------------------------ */
/*  Health check                                                       */
/* ------------------------------------------------------------------ */
export function haHealth(): { available: boolean; addonMode: boolean; apiUrl: string; wsUrl: string } {
  return {
    available: HA_ADDON_MODE && !!SUPERVISOR_TOKEN,
    addonMode: HA_ADDON_MODE,
    apiUrl: HA_API_BASE,
    wsUrl: HA_WS_BASE,
  };
}
