/**
 * Home Assistant Tool Definitions & Executor
 * Provides OpenAI-compatible function schemas for LLM tool-calling,
 * plus an executor that routes validated arguments to ha-api.ts.
 */

import {
  turnOn,
  turnOff,
  toggle,
  setBrightness,
  setColor,
  setTemperature,
  mediaPlay,
  mediaPause,
  playMedia,
  notify,
  tts,
  getState,
  getDeviceMap,
  HAServiceResponse,
} from "./ha-api";

/* ------------------------------------------------------------------ */
/*  Tool Schemas (OpenAI-compatible function definitions)              */
/* ------------------------------------------------------------------ */

export interface HAToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      { type: string; description: string; enum?: string[] }
    >;
    required: string[];
  };
}

export const HA_TOOL_SCHEMAS: HAToolSchema[] = [
  {
    name: "ha_turn_on",
    description: "Turn on a Home Assistant entity (light, switch, etc.)",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Full entity ID, e.g. light.living_room",
        },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "ha_turn_off",
    description: "Turn off a Home Assistant entity (light, switch, etc.)",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Full entity ID, e.g. light.living_room",
        },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "ha_toggle",
    description: "Toggle a Home Assistant entity on/off",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Full entity ID, e.g. switch.coffee_maker",
        },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "ha_set_brightness",
    description: "Set brightness of a light (0-100%)",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Light entity ID, e.g. light.living_room",
        },
        brightness_pct: {
          type: "number",
          description: "Brightness percentage from 0 to 100",
        },
      },
      required: ["entity_id", "brightness_pct"],
    },
  },
  {
    name: "ha_set_color",
    description: "Set color of a light using hex color code",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Light entity ID, e.g. light.kitchen",
        },
        color: { type: "string", description: "Hex color code, e.g. #ff0080" },
      },
      required: ["entity_id", "color"],
    },
  },
  {
    name: "ha_set_temperature",
    description: "Set target temperature for a climate/thermostat entity",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Climate entity ID, e.g. climate.thermostat",
        },
        temperature: {
          type: "number",
          description: "Target temperature in degrees Celsius",
        },
      },
      required: ["entity_id", "temperature"],
    },
  },
  {
    name: "ha_media_play",
    description: "Start playing media on a media player",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description:
            "Media player entity ID, e.g. media_player.living_room_speaker",
        },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "ha_media_pause",
    description: "Pause media playback on a media player",
    parameters: {
      type: "object",
      properties: {
        entity_id: { type: "string", description: "Media player entity ID" },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "ha_play_media",
    description: "Play a specific media URL on a media player",
    parameters: {
      type: "object",
      properties: {
        entity_id: { type: "string", description: "Media player entity ID" },
        media_url: { type: "string", description: "URL of the media to play" },
      },
      required: ["entity_id", "media_url"],
    },
  },
  {
    name: "ha_notify",
    description: "Send a persistent notification to Home Assistant",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Notification message text" },
        title: { type: "string", description: "Notification title" },
      },
      required: ["message"],
    },
  },
  {
    name: "ha_tts",
    description: "Use text-to-speech to announce a message on a speaker",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Text to speak" },
        entity_id: {
          type: "string",
          description:
            "Optional media player entity ID. If omitted, uses default TTS target.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "ha_get_state",
    description: "Get the current state of any Home Assistant entity",
    parameters: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Full entity ID, e.g. sensor.living_room_temp",
        },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "ha_list_devices",
    description: "List all discovered Home Assistant devices by category",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Tool Executor                                                      */
/* ------------------------------------------------------------------ */

export interface ToolCallResult {
  tool: string;
  success: boolean;
  result: unknown;
  message: string;
}

export async function executeHATool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  try {
    let result: unknown;

    switch (toolName) {
      case "ha_turn_on":
        result = await turnOn(args.entity_id as string);
        break;
      case "ha_turn_off":
        result = await turnOff(args.entity_id as string);
        break;
      case "ha_toggle":
        result = await toggle(args.entity_id as string);
        break;
      case "ha_set_brightness":
        result = await setBrightness(
          args.entity_id as string,
          args.brightness_pct as number,
        );
        break;
      case "ha_set_color":
        result = await setColor(args.entity_id as string, args.color as string);
        break;
      case "ha_set_temperature":
        result = await setTemperature(
          args.entity_id as string,
          args.temperature as number,
        );
        break;
      case "ha_media_play":
        result = await mediaPlay(args.entity_id as string);
        break;
      case "ha_media_pause":
        result = await mediaPause(args.entity_id as string);
        break;
      case "ha_play_media":
        result = await playMedia(
          args.entity_id as string,
          args.media_url as string,
        );
        break;
      case "ha_notify":
        result = await notify(
          args.message as string,
          (args.title as string) || "LiTTree-LabStudios",
        );
        break;
      case "ha_tts":
        result = await tts(
          args.message as string,
          args.entity_id as string | undefined,
        );
        break;
      case "ha_get_state":
        result = await getState(args.entity_id as string);
        break;
      case "ha_list_devices":
        result = await getDeviceMap();
        break;
      default:
        return {
          tool: toolName,
          success: false,
          result: null,
          message: `Unknown tool: ${toolName}`,
        };
    }

    const serviceResult = result as HAServiceResponse;
    if (serviceResult && typeof serviceResult.success === "boolean") {
      return {
        tool: toolName,
        success: serviceResult.success,
        result: serviceResult.result ?? serviceResult,
        message: serviceResult.message || `${toolName} executed`,
      };
    }

    return {
      tool: toolName,
      success: true,
      result,
      message: `${toolName} executed successfully`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: toolName, success: false, result: null, message: msg };
  }
}

/* ------------------------------------------------------------------ */
/*  Schema text for LLM prompts                                        */
/* ------------------------------------------------------------------ */

export function getHAToolSchemaText(): string {
  return HA_TOOL_SCHEMAS.map((t) => {
    const params = Object.entries(t.parameters.properties)
      .map(
        ([k, v]) =>
          `  ${k}: ${v.type}${v.enum ? ` (enum: ${v.enum.join(", ")})` : ""} — ${v.description}`,
      )
      .join("\n");
    return `${t.name}:\n  description: ${t.description}\n  parameters:\n${params}`;
  }).join("\n\n");
}
