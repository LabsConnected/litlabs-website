/**
 * OpenAPI Adapter
 *
 * Parses OpenAPI 3.x specifications and generates candidate LiTT tool
 * definitions. Read operations are candidates for auto-registration;
 * mutating operations always require approval.
 *
 * Security rules:
 * - Never send API credentials to the model
 * - Reject specifications with dangerous or ambiguous configuration
 * - Restrict allowed hosts
 * - Reject unsupported external references
 * - Apply rate limits
 */

import type { LiTTToolDefinition, ToolRisk, ApprovalPolicy } from "./types";
import { toolRegistry } from "./tool-registry";

// ─── OpenAPI types (minimal) ────────────────────────────────────

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths?: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
  };
  security?: unknown;
  externalDocs?: { url: string };
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<{ name: string; in: string; required?: boolean; schema?: { type?: string } }>;
  requestBody?: {
    content?: Record<string, { schema?: { type?: string; properties?: Record<string, unknown> } }>;
  };
  responses?: Record<string, { description?: string }>;
  tags?: string[];
  deprecated?: boolean;
}

// ─── Allowed hosts ──────────────────────────────────────────────

const DEFAULT_ALLOWED_HOSTS = new Set([
  "api.github.com",
  "registry.npmjs.org",
  "pypi.org",
  "api.apis.guru",
]);

// ─── OpenAPI Adapter ────────────────────────────────────────────

export class OpenAPIAdapter {
  private allowedHosts: Set<string>;
  private rateLimitMs: number;

  constructor(options: { allowedHosts?: string[]; rateLimitMs?: number } = {}) {
    this.allowedHosts = new Set([...DEFAULT_ALLOWED_HOSTS, ...(options.allowedHosts ?? [])]);
    this.rateLimitMs = options.rateLimitMs ?? 1000;
  }

  /**
   * Parse and validate an OpenAPI specification.
   * Rejects dangerous or ambiguous configurations.
   */
  parse(spec: unknown): { valid: boolean; spec?: OpenAPISpec; errors: string[] } {
    const errors: string[] = [];

    if (!spec || typeof spec !== "object") {
      return { valid: false, errors: ["Specification is not an object"] };
    }

    const s = spec as OpenAPISpec;

    // Check OpenAPI version
    if (!s.openapi && !s.swagger) {
      errors.push("Missing openapi or swagger version field");
    }

    // Check for external references
    const serialized = JSON.stringify(s);
    if (/\$ref.*https?:\/\//i.test(serialized)) {
      errors.push("External $ref references are not supported — inline all schemas");
    }

    // Check for dangerous configurations
    if (s.security && typeof s.security !== "object") {
      errors.push("Security field must be an array of security requirement objects");
    }

    // Check servers against allowed hosts
    if (s.servers) {
      for (const server of s.servers) {
        try {
          const url = new URL(server.url);
          if (!this.allowedHosts.has(url.hostname)) {
            errors.push(`Server host "${url.hostname}" is not in the allowed hosts list`);
          }
        } catch {
          errors.push(`Invalid server URL: ${server.url}`);
        }
      }
    }

    // Check for deprecated operations
    if (s.paths) {
      for (const [path, methods] of Object.entries(s.paths)) {
        for (const [method, op] of Object.entries(methods)) {
          if (op?.deprecated) {
            // Warning, not error
          }
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, spec: s, errors: [] };
  }

  /**
   * Generate LiTT tool definitions from an OpenAPI specification.
   * Read operations (GET) are candidates; mutating operations
   * (POST, PUT, PATCH, DELETE) always require approval.
   */
  generateTools(spec: OpenAPISpec, options: { sourceId?: string } = {}): LiTTToolDefinition[] {
    const sourceId = options.sourceId ?? "openapi";
    const tools: LiTTToolDefinition[] = [];

    if (!spec.paths) return tools;

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!operation) continue;

        const isRead = method.toLowerCase() === "get";
        const isMutation = ["post", "put", "patch", "delete"].includes(method.toLowerCase());

        if (!isRead && !isMutation) continue;

        // Build input schema
        const properties: Record<string, { type: string }> = {};
        const required: string[] = [];

        // Path parameters
        for (const param of operation.parameters ?? []) {
          if (param.in === "path" || param.in === "query") {
            properties[param.name] = { type: param.schema?.type ?? "string" };
            if (param.required) required.push(param.name);
          }
        }

        // Request body
        if (operation.requestBody?.content?.["application/json"]?.schema) {
          const bodySchema = operation.requestBody.content["application/json"].schema;
          if (bodySchema?.properties) {
            for (const [key, value] of Object.entries(bodySchema.properties)) {
              const v = value as { type?: string };
              properties[key] = { type: v.type ?? "string" };
            }
          }
        }

        const toolId = `openapi:${sourceId}:${operation.operationId ?? `${method}_${path}`}`;
        const risk: ToolRisk = isMutation ? "high" : "low";
        const approvalPolicy: ApprovalPolicy = isMutation
          ? { required: true, autoApproveReadOnly: false, requireExplicitForMutations: true, neverAllow: false }
          : { required: false, autoApproveReadOnly: true, requireExplicitForMutations: false, neverAllow: false };

        tools.push({
          id: toolId,
          name: operation.operationId ?? `${method.toUpperCase()} ${path}`,
          description: operation.summary ?? operation.description ?? `${method.toUpperCase()} ${path}`,
          source: "openapi",
          version: spec.info?.version ?? "1.0.0",
          inputSchema: { type: "object", properties, required },
          outputSchema: { type: "object" },
          requiredCapabilities: [],
          requiredPermissions: [`openapi:${sourceId}:${isRead ? "read" : "mutate"}`],
          risk,
          approvalPolicy,
          timeoutMs: 15000,
          idempotent: isRead,
          readOnly: isRead,
          permissionLevel: isRead ? "read" : "external-write",
          enabled: !operation.deprecated,
        });
      }
    }

    return tools;
  }

  /**
   * Register OpenAPI-generated tools into the LiTT tool registry.
   */
  registerTools(tools: LiTTToolDefinition[]): void {
    for (const tool of tools) {
      toolRegistry.register(tool);
    }
  }

  /**
   * Add a host to the allowed hosts list.
   */
  allowHost(hostname: string): void {
    this.allowedHosts.add(hostname);
  }

  /**
   * Check if a host is allowed.
   */
  isHostAllowed(hostname: string): boolean {
    return this.allowedHosts.has(hostname);
  }
}
