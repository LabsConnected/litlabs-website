import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  localLaneEndpointSource,
  resolveLocalLaneEndpoint,
} from "../lib/local-lane.js";

const ENV_KEYS = [
  "LITT_OLLAMA_URL",
  "OLLAMA_HOST_PC",
  "OLLAMA_HOST",
  "OLLAMA_BASE_URL",
] as const;

let originals: Record<string, string | undefined>;

beforeEach(() => {
  originals = {};
  for (const key of ENV_KEYS) {
    originals[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originals[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("OLLAMA_HOST_PC canonical endpoint routing", () => {
  it("resolves a bare LAN PC host", () => {
    process.env.OLLAMA_HOST_PC = "192.168.0.77:11434";

    expect(resolveLocalLaneEndpoint()).toBe(
      "http://192.168.0.77:11434",
    );
    expect(localLaneEndpointSource()).toBe("OLLAMA_HOST_PC");
  });

  it("gives OLLAMA_HOST_PC precedence over generic Ollama variables", () => {
    process.env.OLLAMA_HOST_PC = "192.168.0.77:11434";
    process.env.OLLAMA_HOST = "10.0.0.5:11434";
    process.env.OLLAMA_BASE_URL = "http://10.0.0.6:11434";

    expect(resolveLocalLaneEndpoint()).toBe(
      "http://192.168.0.77:11434",
    );
  });

  it("keeps LITT_OLLAMA_URL as the highest-priority override", () => {
    process.env.LITT_OLLAMA_URL = "http://10.10.10.10:11434";
    process.env.OLLAMA_HOST_PC = "192.168.0.77:11434";

    expect(resolveLocalLaneEndpoint()).toBe(
      "http://10.10.10.10:11434",
    );
    expect(localLaneEndpointSource()).toBe("LITT_OLLAMA_URL");
  });
});
