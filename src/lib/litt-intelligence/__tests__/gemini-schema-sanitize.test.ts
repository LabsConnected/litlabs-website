/**
 * Regression tests for the Gemini function-declaration schema sanitizer.
 *
 * Production incident 2026-09-30: every gemini-2.5-flash agent call 400'd
 * with `Invalid JSON payload received. Unknown name "propertyNames" ...
 * Unknown name "additionalProperties" ...` because tool input schemas were
 * passed straight through to generativelanguage.googleapis.com.
 */

import { describe, it, expect } from "vitest";
import { sanitizeSchemaForGemini } from "@/lib/litt-intelligence/llm-tool-calling";

describe("sanitizeSchemaForGemini", () => {
  it("strips additionalProperties and propertyNames at the top level", () => {
    const input = {
      type: "object",
      properties: {
        name: { type: "string", description: "The name" },
      },
      required: ["name"],
      additionalProperties: false,
      propertyNames: { pattern: "^[a-z]+$" },
    };
    expect(sanitizeSchemaForGemini(input)).toEqual({
      type: "object",
      properties: {
        name: { type: "string", description: "The name" },
      },
      required: ["name"],
    });
  });

  it("strips offending keywords recursively through properties and items", () => {
    const input = {
      type: "object",
      properties: {
        config: {
          type: "object",
          properties: {
            value: {
              type: "string",
              additionalProperties: { type: "string" },
            },
          },
          propertyNames: { type: "string" },
        },
        tags: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { label: { type: "string" } },
          },
        },
      },
    };
    const out = sanitizeSchemaForGemini(input) as Record<string, any>;
    expect(out.properties.config).not.toHaveProperty("propertyNames");
    expect(out.properties.config.properties.value).not.toHaveProperty("additionalProperties");
    expect(out.properties.tags.items).not.toHaveProperty("additionalProperties");
    // supported keywords survive
    expect(out.properties.config.properties.value.type).toBe("string");
    expect(out.properties.tags.items.properties.label.type).toBe("string");
  });

  it("strips schema metadata keywords ($schema, $id, definitions)", () => {
    const input = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "https://example.com/tool",
      type: "object",
      definitions: { name: { type: "string" } },
      properties: { name: { type: "string" } },
    };
    const out = sanitizeSchemaForGemini(input) as Record<string, any>;
    expect(out).not.toHaveProperty("$schema");
    expect(out).not.toHaveProperty("$id");
    expect(out).not.toHaveProperty("definitions");
    expect(out.type).toBe("object");
  });

  it("handles arrays, primitives, and null without mutating input", () => {
    const input = {
      type: "array",
      prefixItems: [{ type: "string", additionalProperties: false }, { type: "number" }],
    };
    const frozen = JSON.parse(JSON.stringify(input));
    const out = sanitizeSchemaForGemini(input) as Record<string, any>;
    expect(out.prefixItems[0]).toEqual({ type: "string" });
    expect(out.prefixItems[1]).toEqual({ type: "number" });
    expect(input).toEqual(frozen);
    expect(sanitizeSchemaForGemini("string")).toBe("string");
    expect(sanitizeSchemaForGemini(null)).toBe(null);
    expect(sanitizeSchemaForGemini(42)).toBe(42);
  });

  it("reproduces the production failure shape without the offending keys", () => {
    // Mirrors the failing declaration: parameters.properties[1].value
    // carrying propertyNames + additionalProperties.
    const properties = {
      path: { type: "string", description: "File path" },
      options: {
        type: "object",
        description: "Options bag",
        properties: {
          value: {
            type: "string",
            propertyNames: { pattern: "^x-" },
            additionalProperties: false,
          },
        },
      },
    };
    const out = sanitizeSchemaForGemini(properties) as Record<string, any>;
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("propertyNames");
    expect(serialized).not.toContain("additionalProperties");
    expect(out.options.properties.value.type).toBe("string");
  });
});
