import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_OLLAMA_URL,
  OLLAMA_ENDPOINT_ENV_VARS,
  normalizeOllamaEndpoint,
  resolveOllamaEndpoint,
  resolveOllamaTagsUrl,
  resolveOllamaChatUrl,
  resolveOllamaOpenAiChatUrl,
  ollamaEndpointSource,
  type EnvGetter,
} from "../ollama-endpoint.js";

const noEnv: EnvGetter = () => undefined;

function envFromMap(map: Record<string, string | undefined>): EnvGetter {
  return (key: string) => map[key];
}

describe("normalizeOllamaEndpoint", () => {
  for (const [input, expected] of [
    ["https://localhost", "https://localhost"],
    ["http://ollama", "http://ollama"],
    ["ollama:11434", "http://ollama:11434"],
    ["[::1]:11434", "http://[::1]:11434"],
    ["https://ollama.internal/proxy/", "https://ollama.internal/proxy"],
  ]) {
    it(`accepts a valid endpoint: ${input}`, () => {
      assert.equal(normalizeOllamaEndpoint(input), expected);
    });
  }

  for (const input of [
    "https://", "http://:11434", "http://localhost:bad", "http://localhost:65536",
    "localhost:0", "http://localhost:0", "http://user:secret@localhost:11434",
    "localhost:11434?key=secret", "http://localhost:11434#fragment",
    "ftp://ollama.local", "ollama.local:123:456", "ollama.local/path",
    "http://bad host:11434", "http://localhost:11434?",
  ]) {
    it(`rejects an invalid endpoint: ${input}`, () => {
      assert.equal(normalizeOllamaEndpoint(input), null);
    });
  }

  it("returns null for undefined", () => {
    assert.equal(normalizeOllamaEndpoint(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.equal(normalizeOllamaEndpoint(""), null);
  });

  it("returns null for whitespace-only string", () => {
    assert.equal(normalizeOllamaEndpoint("   "), null);
  });

  it("normalizes bare host:port to http://", () => {
    assert.equal(normalizeOllamaEndpoint("192.168.0.77:11434"), "http://192.168.0.77:11434");
  });

  it("normalizes bare hostname to http://", () => {
    assert.equal(normalizeOllamaEndpoint("ollama.local"), "http://ollama.local");
  });

  it("preserves http:// URL", () => {
    assert.equal(normalizeOllamaEndpoint("http://192.168.0.77:11434"), "http://192.168.0.77:11434");
  });

  it("preserves https:// URL", () => {
    assert.equal(normalizeOllamaEndpoint("https://ollama.example.com:11434"), "https://ollama.example.com:11434");
  });

  it("strips trailing slashes", () => {
    assert.equal(normalizeOllamaEndpoint("http://192.168.0.77:11434/"), "http://192.168.0.77:11434");
    assert.equal(normalizeOllamaEndpoint("http://192.168.0.77:11434///"), "http://192.168.0.77:11434");
  });

  it("returns null for bare scheme without host", () => {
    assert.equal(normalizeOllamaEndpoint("http://"), null);
  });
});

describe("resolveOllamaEndpoint — localhost default", () => {
  it("defaults to localhost:11434 when no env var is set", () => {
    assert.equal(resolveOllamaEndpoint(noEnv), DEFAULT_OLLAMA_URL);
    assert.equal(resolveOllamaEndpoint(noEnv), "http://localhost:11434");
  });

  it("defaults to localhost when env vars are empty strings", () => {
    const env = envFromMap({
      LITT_OLLAMA_URL: "",
      OLLAMA_BASE_URL: "   ",
      OLLAMA_HOST: "",
    });
    assert.equal(resolveOllamaEndpoint(env), DEFAULT_OLLAMA_URL);
  });
});

describe("resolveOllamaEndpoint — LAN LITT_OLLAMA_URL", () => {
  it("resolves LITT_OLLAMA_URL with full URL", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" });
    assert.equal(resolveOllamaEndpoint(env), "http://192.168.0.77:11434");
  });

  it("resolves LITT_OLLAMA_URL with bare host:port", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "192.168.0.77:11434" });
    assert.equal(resolveOllamaEndpoint(env), "http://192.168.0.77:11434");
  });

  it("LITT_OLLAMA_URL takes precedence over OLLAMA_BASE_URL", () => {
    const env = envFromMap({
      LITT_OLLAMA_URL: "http://192.168.0.77:11434",
      OLLAMA_BASE_URL: "http://10.0.0.5:11434",
    });
    assert.equal(resolveOllamaEndpoint(env), "http://192.168.0.77:11434");
  });

  it("LITT_OLLAMA_URL takes precedence over OLLAMA_HOST", () => {
    const env = envFromMap({
      LITT_OLLAMA_URL: "http://192.168.0.77:11434",
      OLLAMA_HOST: "10.0.0.5:11434",
    });
    assert.equal(resolveOllamaEndpoint(env), "http://192.168.0.77:11434");
  });
});

describe("resolveOllamaEndpoint — OLLAMA_BASE_URL compatibility", () => {
  it("resolves OLLAMA_BASE_URL when LITT_OLLAMA_URL is not set", () => {
    const env = envFromMap({ OLLAMA_BASE_URL: "http://10.0.0.5:11434" });
    assert.equal(resolveOllamaEndpoint(env), "http://10.0.0.5:11434");
  });

  it("normalizes bare host:port in OLLAMA_BASE_URL", () => {
    const env = envFromMap({ OLLAMA_BASE_URL: "10.0.0.5:11434" });
    assert.equal(resolveOllamaEndpoint(env), "http://10.0.0.5:11434");
  });
});

describe("resolveOllamaEndpoint — OLLAMA_HOST compatibility", () => {
  it("prefers OLLAMA_HOST over the compatibility alias and reports that source", () => {
    const env = envFromMap({
      OLLAMA_HOST: "ollama:11434",
      OLLAMA_BASE_URL: "http://stale.local:11434",
    });
    assert.equal(resolveOllamaEndpoint(env), "http://ollama:11434");
    assert.equal(ollamaEndpointSource(env), "OLLAMA_HOST");
  });

  it("resolves OLLAMA_HOST when LITT_OLLAMA_URL and OLLAMA_BASE_URL are not set", () => {
    const env = envFromMap({ OLLAMA_HOST: "192.168.0.77:11434" });
    assert.equal(resolveOllamaEndpoint(env), "http://192.168.0.77:11434");
  });

  it("normalizes bare host:port in OLLAMA_HOST", () => {
    const env = envFromMap({ OLLAMA_HOST: "10.0.0.5:11434" });
    assert.equal(resolveOllamaEndpoint(env), "http://10.0.0.5:11434");
  });
});

describe("resolveOllamaEndpoint — bare host:port normalization", () => {
  it("normalizes bare host:port across all env vars", () => {
    for (const key of OLLAMA_ENDPOINT_ENV_VARS) {
      const env = envFromMap({ [key]: "192.168.1.100:11434" });
      assert.equal(resolveOllamaEndpoint(env), "http://192.168.1.100:11434");
    }
  });
});

describe("resolveOllamaEndpoint — override", () => {
  it("explicit override takes precedence over env vars", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" });
    assert.equal(resolveOllamaEndpoint(env, "http://10.0.0.99:11434"), "http://10.0.0.99:11434");
  });

  it("falls through to env when override is invalid", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" });
    assert.equal(resolveOllamaEndpoint(env, ""), "http://192.168.0.77:11434");
  });
});

describe("resolveOllamaTagsUrl", () => {
  it("appends /api/tags to the resolved endpoint", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" });
    assert.equal(resolveOllamaTagsUrl(env), "http://192.168.0.77:11434/api/tags");
  });

  it("appends /api/tags to the default endpoint", () => {
    assert.equal(resolveOllamaTagsUrl(noEnv), "http://localhost:11434/api/tags");
  });
});

describe("resolveOllamaChatUrl", () => {
  it("appends /api/chat to the resolved endpoint", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" });
    assert.equal(resolveOllamaChatUrl(env), "http://192.168.0.77:11434/api/chat");
  });
});

describe("resolveOllamaOpenAiChatUrl", () => {
  it("appends /v1/chat/completions to the resolved endpoint", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" });
    assert.equal(resolveOllamaOpenAiChatUrl(env), "http://192.168.0.77:11434/v1/chat/completions");
  });
});

describe("ollamaEndpointSource", () => {
  it("returns 'default' when no env var is set", () => {
    assert.equal(ollamaEndpointSource(noEnv), "default");
  });

  it("returns 'LITT_OLLAMA_URL' when that var is set", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.0.77:11434" });
    assert.equal(ollamaEndpointSource(env), "LITT_OLLAMA_URL");
  });

  it("returns 'OLLAMA_BASE_URL' when that var is set", () => {
    const env = envFromMap({ OLLAMA_BASE_URL: "http://10.0.0.5:11434" });
    assert.equal(ollamaEndpointSource(env), "OLLAMA_BASE_URL");
  });

  it("returns 'OLLAMA_HOST' when that var is set", () => {
    const env = envFromMap({ OLLAMA_HOST: "192.168.0.77:11434" });
    assert.equal(ollamaEndpointSource(env), "OLLAMA_HOST");
  });

  it("returns 'override' when explicit override is provided", () => {
    assert.equal(ollamaEndpointSource(noEnv, "http://10.0.0.99:11434"), "override");
  });

  it("returns 'default' when env vars are empty", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "", OLLAMA_HOST: "  " });
    assert.equal(ollamaEndpointSource(env), "default");
  });
});

describe("resolveOllamaEndpoint — unreachable endpoint does not fabricate", () => {
  it("resolves to the configured endpoint even if unreachable (probe is caller's job)", () => {
    const env = envFromMap({ LITT_OLLAMA_URL: "http://192.168.99.99:11434" });
    assert.equal(resolveOllamaEndpoint(env), "http://192.168.99.99:11434");
  });
});
